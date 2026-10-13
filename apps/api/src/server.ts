import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { pool, transaction } from "../../../db/client.js";
import {
  applyOperation,
  authorize,
  audit,
  snapshot,
  HttpError,
} from "./service.js";
import { authenticate, demoEnabled, demoToken, supabase } from "./auth.js";
import { seal } from "./secrets.js";
import { validateEndpoint } from "../../worker/src/push.js";
import {
  cronAuthorized,
  runReminderBatch,
} from "../../worker/src/serverless.js";
import { PostgresRateStore } from "./rate-store.js";
import {
  checkNewPin,
  hashPin,
  normalizePhone,
  phoneEmail,
  providerPassword,
  verifyPinAttempt,
} from "./pin-auth.js";
import { productionConfigErrors } from "../../../scripts/production-config.js";
import { once } from "node:events";
import { runRetention } from "../../worker/src/retention.js";
if (process.env.VERCEL) {
  const errors = productionConfigErrors(process.env);
  if (errors.length)
    throw new Error("Production configuration: " + errors.join("; "));
}
export const app = express();
app.disable("x-powered-by");
// Trust exactly one owned reverse proxy; the API container has no published port.
app.set(
  "trust proxy",
  process.env.VERCEL || process.env.TRUST_PROXY === "1" ? 1 : false,
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "blob:", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", process.env.SUPABASE_URL || "'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 120,
    message: { error: "Too many requests" },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(process.env.VERCEL ? { store: new PostgresRateStore("api") } : {}),
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    req.headers.origin !== process.env.PUBLIC_APP_URL &&
    !(
      process.env.NODE_ENV !== "production" &&
      req.headers.origin === "http://localhost:5173"
    )
  ) {
    res.status(403).json({ error: "Origin denied" });
    return;
  }
  next();
});
app.get("/api/health", async (_req, res) => {
  const health = (await pool.query("SELECT * FROM worker_health")).rows;
  res.json({
    database: "reachable",
    worker: health.map((h) => ({
      heartbeat: h.heartbeat,
      horizonAt: h.horizon_at,
    })),
    adapter: process.env.PUSH_ADAPTER || "webpush",
  });
});
app.post("/api/internal/reminders", async (req, res) => {
  if (!cronAuthorized(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized scheduler" });
    return;
  }
  res.json(await runReminderBatch());
});
app.post("/api/internal/maintenance", async (req, res) => {
  if (!cronAuthorized(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized scheduler" });
    return;
  }
  res.json(await runRetention(1));
});
app.post("/api/demo", async (req, res) => {
  if (
    !demoEnabled() ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress || "",
    )
  )
    throw new HttpError(403, "Local synthetic demo only");
  res.json({ token: await demoToken() });
});
// Phone + PIN sign-in. Brute force is limited per number (lockout in
// verifyPinAttempt) and per client address here.
const pinLimiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  message: { error: "Too many requests" },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ...(process.env.VERCEL ? { store: new PostgresRateStore("pin") } : {}),
});
async function issueSession(phone: string) {
  const { data, error } = await supabase().auth.signInWithPassword({
    email: phoneEmail(phone),
    password: providerPassword(phone),
  });
  if (error || !data.session)
    throw new HttpError(503, "Sign-in service unavailable; try again");
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user_id: data.session.user.id,
  };
}
app.post("/api/auth/pin/register", pinLimiter, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const pin = String(req.body?.pin ?? "");
  checkNewPin(pin);
  const existing = (
    await pool.query(
      "SELECT user_id,pin_hash FROM pin_credentials WHERE phone=$1",
      [phone],
    )
  ).rows[0];
  if (existing?.pin_hash)
    throw new HttpError(409, "This phone number is already registered");
  let userId: string | undefined = existing?.user_id;
  if (!userId) {
    const { data } = await supabase().auth.admin.createUser({
      email: phoneEmail(phone),
      password: providerPassword(phone),
      email_confirm: true,
      user_metadata: { phone },
    });
    // An interrupted earlier registration may already have created the account.
    userId = data?.user?.id || (await issueSession(phone)).user_id;
  }
  const saved = await pool.query(
    "INSERT INTO pin_credentials(phone,user_id,pin_hash) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET pin_hash=excluded.pin_hash,failed_attempts=0,lock_count=0,locked_until=NULL,updated_at=now() WHERE pin_credentials.pin_hash IS NULL",
    [phone, userId, await hashPin(phone, pin)],
  );
  if (!saved.rowCount)
    throw new HttpError(409, "This phone number is already registered");
  res.json(await issueSession(phone));
});
app.post("/api/auth/pin/login", pinLimiter, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const result = await transaction((c) =>
    verifyPinAttempt(c, { phone }, String(req.body?.pin ?? "")),
  );
  if ("error" in result) throw result.error;
  res.json(await issueSession(phone));
});
app.use("/api", async (req, res, next) => {
  try {
    const user = await authenticate(
      req.headers.authorization?.replace(/^Bearer /, "") || "",
    );
    res.locals.user = user;
    await pool.query(
      "INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING",
      [user.id],
    );
    next();
  } catch (e) {
    next(e);
  }
});
app.get("/api/patients", async (_req, res) => {
  res.json(
    (
      await pool.query(
        "SELECT p.id,p.data,m.role FROM patients p JOIN memberships m ON m.patient_id=p.id WHERE m.user_id=$1 AND m.revoked_at IS NULL AND p.deleted_at IS NULL",
        [res.locals.user.id],
      )
    ).rows,
  );
});
app.post("/api/patients", async (req, res) => {
  const actor = res.locals.user.id;
  const d = z
    .object({ displayName: z.string().min(1).max(200) })
    .parse(req.body);
  const p = await transaction(async (c) => {
    await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor]);
    if (
      (
        await c.query(
          "SELECT id FROM patients WHERE owner_id=$1 AND deleted_at IS NULL",
          [actor],
        )
      ).rowCount
    )
      throw new HttpError(409, "One owner profile per account");
    const id = randomUUID();
    await c.query("INSERT INTO patients(id,owner_id,data) VALUES($1,$2,$3)", [
      id,
      actor,
      {
        ...d,
        language: "th",
        timezone: "Asia/Bangkok",
        allergyStatus: "unknown",
        allergies: [],
      },
    ]);
    await c.query("INSERT INTO memberships VALUES($1,$2,'owner',NULL)", [
      id,
      actor,
    ]);
    return id;
  });
  res.json({ id: p });
});
app.get("/api/patients/:id/snapshot", async (req, res) =>
  res.json(
    await snapshot(res.locals.user.id, z.string().uuid().parse(req.params.id)),
  ),
);
app.get("/api/patients/:id/summary", async (req, res) =>
  res.json(
    await snapshot(res.locals.user.id, z.string().uuid().parse(req.params.id)),
  ),
);
app.post("/api/sync/push", async (req, res) => {
  const operations = z.array(z.unknown()).max(50).parse(req.body.operations);
  const results = [];
  for (const op of operations) {
    try {
      results.push(await applyOperation(res.locals.user.id, op));
    } catch (e) {
      if (e instanceof HttpError)
        results.push({
          id: (op as any).id,
          status: e.status === 409 ? "conflict" : "rejected",
          error: e.message,
          current: e.current,
        });
      else if (e instanceof z.ZodError)
        results.push({
          id: (op as any).id,
          status: "rejected",
          error: e.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        });
      else throw e;
    }
  }
  res.json({ results });
});
app.get("/api/sync/pull", async (req, res) => {
  const cursor = z.coerce
    .number()
    .int()
    .nonnegative()
    .parse(req.query.cursor || 0);
  const rows = (
    await pool.query(
      "SELECT f.* FROM change_feed f JOIN memberships m ON m.patient_id=f.patient_id WHERE m.user_id=$1 AND m.revoked_at IS NULL AND f.cursor>$2 ORDER BY cursor LIMIT 500",
      [res.locals.user.id, cursor],
    )
  ).rows;
  res.json({ changes: rows, cursor: rows.at(-1)?.cursor || cursor });
});
app.get("/api/devices", async (_req, res) => {
  res.json(
    (
      await pool.query(
        "SELECT d.*,s.id subscription_id,s.disabled_at FROM devices d LEFT JOIN push_subscriptions s ON s.device_id=d.id WHERE d.user_id=$1",
        [res.locals.user.id],
      )
    ).rows,
  );
});
app.post("/api/push-subscriptions", async (req, res) => {
  const d = z
    .object({
      deviceId: z.string().uuid(),
      patientId: z.string().uuid(),
      label: z.string().min(1).max(100),
      consent: z.literal(true),
      subscription: z.object({
        endpoint: z.string().url(),
        keys: z.object({
          p256dh: z.string().min(80).max(200),
          auth: z.string().min(16).max(100),
        }),
        expirationTime: z.number().nullable().optional(),
      }),
    })
    .parse(req.body);
  validateEndpoint(d.subscription.endpoint);
  await transaction(async (c) => {
    await authorize(c, res.locals.user.id, d.patientId);
    const device = (
      await c.query("SELECT * FROM devices WHERE id=$1 FOR UPDATE", [
        d.deviceId,
      ])
    ).rows[0];
    if (device && device.user_id !== res.locals.user.id)
      throw new HttpError(403, "Device belongs to another account");
    const hash = createHash("sha256")
      .update(d.subscription.endpoint)
      .digest("hex");
    const existing = (
      await c.query(
        "SELECT s.device_id,d.user_id FROM push_subscriptions s JOIN devices d ON d.id=s.device_id WHERE s.endpoint_hash=$1",
        [hash],
      )
    ).rows[0];
    if (existing && existing.user_id !== res.locals.user.id)
      throw new HttpError(403, "Endpoint is bound to another account");
    await c.query(
      "INSERT INTO devices(id,user_id,label) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET revoked_at=NULL,last_seen=now(),label=excluded.label",
      [d.deviceId, res.locals.user.id, d.label],
    );
    await c.query(
      "UPDATE push_subscriptions SET disabled_at=now() WHERE device_id=$1",
      [d.deviceId],
    );
    await c.query(
      "INSERT INTO push_subscriptions(id,device_id,endpoint_hash,data) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint_hash) DO UPDATE SET data=excluded.data,device_id=excluded.device_id,disabled_at=NULL",
      [randomUUID(), d.deviceId, hash, seal(d.subscription)],
    );
    await c.query(
      "INSERT INTO reminder_preferences VALUES($1,$2,true) ON CONFLICT(patient_id,device_id) DO UPDATE SET enabled=true",
      [d.patientId, d.deviceId],
    );
  });
  res.json({ registered: true });
});
app.delete("/api/devices/:id", async (req, res) => {
  await transaction(async (c) => {
    const r = await c.query(
      "UPDATE devices SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
      [z.string().uuid().parse(req.params.id), res.locals.user.id],
    );
    if (!r.rowCount) throw new HttpError(404, "Device not found");
    await c.query(
      "UPDATE push_subscriptions SET disabled_at=now() WHERE device_id=$1",
      [req.params.id],
    );
  });
  res.json({ revoked: true });
});
app.get("/api/push/config", (_req, res) =>
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
    adapter: process.env.PUSH_ADAPTER || "webpush",
  }),
);
app.post(
  "/api/push/test",
  rateLimit({
    windowMs: 60000,
    limit: 3,
    ...(process.env.VERCEL
      ? { store: new PostgresRateStore("push-test") }
      : {}),
  }),
  async (req, res) => {
    const d = z
      .object({ deviceId: z.string().uuid(), patientId: z.string().uuid() })
      .parse(req.body);
    await authorize(pool, res.locals.user.id, d.patientId);
    const s = (
      await pool.query(
        "SELECT s.id FROM push_subscriptions s JOIN devices d ON d.id=s.device_id WHERE d.id=$1 AND d.user_id=$2 AND d.revoked_at IS NULL AND s.disabled_at IS NULL",
        [d.deviceId, res.locals.user.id],
      )
    ).rows[0];
    if (!s) throw new HttpError(404, "Register device first");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,kind,due_at,expires_at) VALUES($1::uuid,$2,$3,$1::text,'test','[]','test',now(),now()+interval '15 minutes')",
      [id, d.patientId, s.id],
    );
    res.json({ state: "queued", id });
  },
);
app.get("/api/push/resolve/:id", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const job = (
    await pool.query(
      "SELECT j.patient_id FROM reminder_jobs j JOIN push_subscriptions s ON s.id=j.subscription_id JOIN devices d ON d.id=s.device_id WHERE j.id=$1 AND d.user_id=$2 AND d.revoked_at IS NULL",
      [id, res.locals.user.id],
    )
  ).rows[0];
  if (!job)
    throw new HttpError(403, "Notification unavailable for this account");
  await authorize(pool, res.locals.user.id, job.patient_id);
  res.json({ patientId: job.patient_id });
});
app.post("/api/push/observations", async (req, res) => {
  const d = z
    .object({
      jobId: z.string().uuid(),
      deviceId: z.string().uuid(),
      kind: z.enum(["opened", "test-seen"]),
    })
    .parse(req.body);
  const job = (
    await pool.query(
      "SELECT j.*,d.user_id,d.revoked_at FROM reminder_jobs j JOIN push_subscriptions s ON s.id=j.subscription_id JOIN devices d ON d.id=s.device_id WHERE j.id=$1 AND d.id=$2 AND d.user_id=$3",
      [d.jobId, d.deviceId, res.locals.user.id],
    )
  ).rows[0];
  if (!job || job.revoked_at || (d.kind === "test-seen" && job.kind !== "test"))
    throw new HttpError(403, "Observation not authorized");
  await authorize(pool, res.locals.user.id, job.patient_id);
  await pool.query(
    "INSERT INTO push_observations(id,job_id,actor_id,device_id,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [randomUUID(), d.jobId, res.locals.user.id, d.deviceId, d.kind],
  );
  res.json({ recorded: true });
});
app.post("/api/auth/pin/change", pinLimiter, async (req, res) => {
  const newPin = String(req.body?.newPin ?? "");
  checkNewPin(newPin);
  const result = await transaction((c) =>
    verifyPinAttempt(
      c,
      { userId: res.locals.user.id },
      String(req.body?.currentPin ?? ""),
    ),
  );
  if ("error" in result) throw result.error;
  await pool.query(
    "UPDATE pin_credentials SET pin_hash=$2,updated_at=now() WHERE phone=$1",
    [result.phone, await hashPin(result.phone, newPin)],
  );
  res.json({ changed: true });
});
app.post("/api/patients/:id/invitations", async (req, res) => {
  const d = z
    .object({
      recipient: z.string().trim().min(3).max(320),
      role: z.enum(["viewer", "editor"]),
    })
    .parse(req.body);
  // Caregivers are invited by email or by the phone number they sign in with.
  const recipient = d.recipient.includes("@")
    ? z.string().email().parse(d.recipient)
    : phoneEmail(normalizePhone(d.recipient));
  const token = randomBytes(32).toString("base64url");
  await transaction(async (c) => {
    await authorize(c, res.locals.user.id, req.params.id, "owner");
    await c.query(
      "INSERT INTO invitations(id,patient_id,token_hash,recipient,role,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '48 hours')",
      [
        randomUUID(),
        req.params.id,
        createHash("sha256").update(token).digest("hex"),
        recipient.toLowerCase(),
        d.role,
      ],
    );
    await audit(c, res.locals.user.id, req.params.id, "invite", req.params.id);
  });
  res.json({ token, expiresInHours: 48 });
});
app.post("/api/invitations/accept", async (req, res) => {
  const d = z
    .object({ token: z.string().min(40).max(100), agreed: z.literal(true) })
    .parse(req.body);
  await transaction(async (c) => {
    const inv = (
      await c.query(
        "SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE",
        [createHash("sha256").update(d.token).digest("hex")],
      )
    ).rows[0];
    if (
      !inv ||
      inv.consumed_at ||
      inv.revoked_at ||
      inv.expires_at < new Date() ||
      inv.recipient !== res.locals.user.email.toLowerCase()
    )
      throw new HttpError(
        403,
        "Invitation invalid, expired, or for another account",
      );
    await c.query(
      "INSERT INTO memberships VALUES($1,$2,$3,NULL) ON CONFLICT(patient_id,user_id) DO UPDATE SET role=CASE WHEN memberships.role='owner' THEN 'owner' ELSE excluded.role END,revoked_at=NULL",
      [inv.patient_id, res.locals.user.id, inv.role],
    );
    await c.query("UPDATE invitations SET consumed_at=now() WHERE id=$1", [
      inv.id,
    ]);
    await audit(
      c,
      res.locals.user.id,
      inv.patient_id,
      "invite-accepted",
      inv.id,
    );
  });
  res.json({ accepted: true });
});
app.get("/api/patients/:id/memberships", async (req, res) => {
  await authorize(pool, res.locals.user.id, req.params.id, "owner");
  res.json(
    (
      await pool.query(
        "SELECT user_id,role,revoked_at FROM memberships WHERE patient_id=$1",
        [req.params.id],
      )
    ).rows,
  );
});
app.patch("/api/patients/:id/memberships/:user", async (req, res) => {
  const role = z.enum(["viewer", "editor"]).parse(req.body.role);
  await transaction(async (c) => {
    await authorize(c, res.locals.user.id, req.params.id, "owner");
    const r = await c.query(
      "UPDATE memberships SET role=$3 WHERE patient_id=$1 AND user_id=$2 AND role<>'owner' AND revoked_at IS NULL RETURNING user_id",
      [req.params.id, req.params.user, role],
    );
    if (!r.rowCount) throw new HttpError(404, "Caregiver not found");
    await audit(
      c,
      res.locals.user.id,
      req.params.id,
      "role-change",
      req.params.user,
    );
  });
  res.json({ updated: true });
});
app.delete("/api/patients/:id/memberships/:user", async (req, res) => {
  await transaction(async (c) => {
    await authorize(c, res.locals.user.id, req.params.id, "owner");
    await c.query(
      "UPDATE memberships SET revoked_at=now() WHERE patient_id=$1 AND user_id=$2 AND role<>'owner'",
      [req.params.id, req.params.user],
    );
    await c.query(
      "UPDATE reminder_preferences p SET enabled=false FROM devices d WHERE d.id=p.device_id AND p.patient_id=$1 AND d.user_id=$2",
      [req.params.id, req.params.user],
    );
    await audit(
      c,
      res.locals.user.id,
      req.params.id,
      "membership-revoked",
      req.params.user,
      true,
    );
  });
  res.json({ revoked: true });
});
app.post(
  "/api/patients/:id/photos",
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "2mb",
  }),
  async (req, res) => {
    await authorize(pool, res.locals.user.id, req.params.id, "editor");
    const med = z.string().uuid().parse(req.query.medicationId);
    if (
      !(
        await pool.query(
          "SELECT id FROM medications WHERE id=$1 AND patient_id=$2",
          [med, req.params.id],
        )
      ).rowCount
    )
      throw new HttpError(403, "Access denied");
    if (req.query.photoId) {
      const old = (
        await pool.query(
          "SELECT patient_id,medication_id FROM photos WHERE id=$1",
          [z.string().uuid().parse(req.query.photoId)],
        )
      ).rows[0];
      if (old) {
        if (old.patient_id !== req.params.id || old.medication_id !== med)
          throw new HttpError(403, "Access denied");
        res.json({ id: req.query.photoId });
        return;
      }
    }
    if (!Buffer.isBuffer(req.body))
      throw new HttpError(
        422,
        "Use JPEG, PNG or WebP, at most 2 MB after compression",
      );
    let bytes: Buffer;
    try {
      bytes = await sharp(req.body, { limitInputPixels: 25000000 })
        .rotate()
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw new HttpError(422, "Unsupported image; export photo as JPEG");
    }
    if (bytes.length > 2 * 1024 * 1024)
      throw new HttpError(422, "Photo is too large; choose a smaller image");
    const id = req.query.photoId
        ? z.string().uuid().parse(req.query.photoId)
        : randomUUID(),
      key = `${req.params.id}/${id}.jpg`;
    if (!demoEnabled()) {
      const { error } = await supabase()
        .storage.from(process.env.PRIVATE_PHOTO_BUCKET || "medication-photos")
        .upload(key, bytes, { contentType: "image/jpeg", upsert: true });
      if (error) throw new HttpError(503, "Private photo upload failed");
    }
    await pool.query(
      "INSERT INTO photos(id,patient_id,medication_id,storage_key,mime,size,bytes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
      [
        id,
        req.params.id,
        med,
        key,
        "image/jpeg",
        bytes.length,
        demoEnabled() ? bytes : null,
      ],
    );
    res.json({ id });
  },
);
app.get("/api/photos/:id", async (req, res) => {
  const p = (
    await pool.query("SELECT * FROM photos WHERE id=$1", [
      z.string().uuid().parse(req.params.id),
    ])
  ).rows[0];
  if (!p) throw new HttpError(404, "Photo not found");
  await authorize(pool, res.locals.user.id, p.patient_id);
  if (p.bytes) {
    res.type(p.mime).send(p.bytes);
    return;
  }
  const { data, error } = await supabase()
    .storage.from(process.env.PRIVATE_PHOTO_BUCKET || "medication-photos")
    .download(p.storage_key);
  if (error || !data) throw new HttpError(503, "Photo unavailable");
  res.type(p.mime).send(Buffer.from(await data.arrayBuffer()));
});
app.post("/api/account/export", async (_req, res) => {
  const actor = res.locals.user.id;
  const patients = (
    await pool.query(
      "SELECT patient_id FROM memberships WHERE user_id=$1 AND role='owner' AND revoked_at IS NULL",
      [actor],
    )
  ).rows;
  const profiles = await Promise.all(
    patients.map((p) => snapshot(actor, p.patient_id)),
  );
  // Stream individual photo records so exports do not hit Vercel's buffered
  // response limit or accumulate all base64 files in server memory.
  res.type("application/json");
  const write = async (value: string) => {
    const bytes = Buffer.from(value);
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      if (res.destroyed) throw new Error("Export connection closed");
      if (!res.write(bytes.subarray(offset, offset + 32768)))
        await once(res, "drain", { signal: AbortSignal.timeout(10000) });
    }
  };
  await write(
    JSON.stringify({ generatedAt: new Date().toISOString(), profiles }).slice(
      0,
      -1,
    ) + ',"photoFiles":[',
  );
  let first = true;
  for (const profile of profiles)
    for (const photo of profile.photos) {
      const p = (
        await pool.query("SELECT * FROM photos WHERE id=$1 AND patient_id=$2", [
          photo.id,
          profile.profile.id,
        ])
      ).rows[0];
      if (!p) throw new HttpError(409, "Photo changed during export; retry");
      let bytes: Buffer;
      if (p.bytes) bytes = p.bytes;
      else {
        const { data, error } = await supabase()
          .storage.from(process.env.PRIVATE_PHOTO_BUCKET || "medication-photos")
          .download(p.storage_key);
        if (error || !data)
          throw new HttpError(503, "Private photo export failed; retry");
        bytes = Buffer.from(await data.arrayBuffer());
      }
      await write(
        (first ? "" : ",") +
          JSON.stringify({
            id: p.id,
            patientId: p.patient_id,
            medicationId: p.medication_id,
            mime: p.mime,
            base64: bytes.toString("base64"),
          }),
      );
      first = false;
    }
  res.end("]}");
});
app.delete("/api/account", async (req, res) => {
  if (
    res.locals.user.authTime < Date.now() - 5 * 60000 ||
    req.body.confirm !== "DELETE"
  )
    throw new HttpError(401, "Sign in again and confirm DELETE");
  const actor = res.locals.user.id;
  await transaction(async (c) => {
    const owned = (
      await c.query("SELECT id FROM patients WHERE owner_id=$1", [actor])
    ).rows;
    for (const p of owned) {
      await c.query("UPDATE patients SET deleted_at=now() WHERE id=$1", [p.id]);
      await c.query(
        "UPDATE memberships SET revoked_at=now() WHERE patient_id=$1",
        [p.id],
      );
      await c.query(
        "UPDATE reminder_jobs SET state='cancelled' WHERE patient_id=$1 AND state IN ('queued','leased')",
        [p.id],
      );
      await audit(c, actor, p.id, "account-deletion", p.id, true);
    }
    await c.query("UPDATE memberships SET revoked_at=now() WHERE user_id=$1", [
      actor,
    ]);
    await c.query("UPDATE devices SET revoked_at=now() WHERE user_id=$1", [
      actor,
    ]);
    // Frees the phone number for a new registration.
    await c.query("DELETE FROM pin_credentials WHERE user_id=$1", [actor]);
  });
  await pool.query(
    "INSERT INTO account_deletions(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [actor],
  );
  let identityCleanup = "pending";
  if (demoEnabled()) identityCleanup = "synthetic-local-account";
  else {
    try {
      const { error } = await supabase().auth.admin.deleteUser(actor);
      if (!error) {
        await pool.query(
          "UPDATE account_deletions SET provider_deleted_at=now() WHERE user_id=$1",
          [actor],
        );
        identityCleanup = "complete";
      }
    } catch {
      /* Durable retention operator retries provider cleanup. */
    }
  }
  res.json({
    identityCleanup,
    deleted: true,
    retention:
      "Tombstoned immediately; private records purged by documented retention job within 30 days; backups expire after 30 days.",
  });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found" }),
);
app.use(
  express.static("dist", {
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-cache");
    },
  }),
);
app.get("/{*path}", (_req, res) =>
  res.sendFile("index.html", { root: "dist" }),
);
app.use(
  (
    e: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (e instanceof z.ZodError) {
      res.status(422).json({ error: "Invalid input", fields: e.issues });
      return;
    }
    // Error class/code only: messages can contain patient data or connection details.
    if (!e.status)
      console.error(
        "Request failed",
        _req.method,
        _req.route?.path || "unmatched",
        e?.name || "Error",
        e?.code || "",
      );
    res.status(e.status || 500).json({
      error: e.status ? e.message : "Request failed",
      current: e.current,
    });
  },
);
if (process.env.NODE_ENV === "production" && process.env.LOCAL_DEMO === "true")
  throw new Error("LOCAL_DEMO forbidden in production");
if (process.env.VITEST !== "true" && !process.env.VERCEL)
  app.listen(Number(process.env.PORT || 3001), () =>
    console.log("API listening; sensitive request logging disabled"),
  );
