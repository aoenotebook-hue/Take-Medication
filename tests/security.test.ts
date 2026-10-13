import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Server } from "node:http";
import { pool, transaction } from "../db/client";
import sharp from "sharp";
import { seal, unseal } from "../apps/api/src/secrets";
let server: Server, base: string, token: string;
const patient = "22222222-2222-4222-a222-222222222222";
beforeAll(async () => {
  process.env.LOCAL_DEMO = "true";
  process.env.VITEST = "true";
  const { app } = await import("../apps/api/src/server");
  const { demoToken } = await import("../apps/api/src/auth");
  token = await demoToken();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = "http://127.0.0.1:" + (server.address() as any).port;
});
afterAll(async () => {
  server?.close();
  await pool.end();
});
async function request(
  path: string,
  method = "GET",
  body?: any,
  headers: any = {},
) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
it("unauthenticated access and cross-origin writes fail without logging health data", async () => {
  expect(
    (await request("/patients", "GET", undefined, { Authorization: "" }))
      .status,
  ).toBe(401);
  expect(
    (
      await request(
        "/sync/push",
        "POST",
        { operations: [] },
        { Origin: "https://evil.invalid" },
      )
    ).status,
  ).toBe(403);
  const r = await request("/patients/" + randomUUID() + "/snapshot");
  expect(r.status).toBe(403);
  expect((await request("/push/resolve/" + randomUUID())).status).toBe(403);
  expect(r.headers.get("cache-control")).toBe("no-store");
});
it("scheduler and retention endpoints reject ordinary signed-in users", async () => {
  for (const path of ["/internal/reminders", "/internal/maintenance"])
    expect((await request(path, "POST", {})).status).toBe(401);
  expect((await request("/unknown-route")).status).toBe(404);
});
it("invitations are email-bound, single-use and expire", async () => {
  const r = await request("/patients/" + patient + "/invitations", "POST", {
    recipient: "demo@example.invalid",
    role: "viewer",
  });
  expect(r.status).toBe(200);
  const { token: invite } = await r.json();
  expect(
    (
      await request("/invitations/accept", "POST", {
        token: invite,
        agreed: true,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await pool.query(
        "SELECT role FROM memberships WHERE patient_id=$1 AND user_id=$2",
        [patient, "11111111-1111-4111-a111-111111111111"],
      )
    ).rows[0].role,
  ).toBe("owner");
  expect(
    (
      await request("/invitations/accept", "POST", {
        token: invite,
        agreed: true,
      })
    ).status,
  ).toBe(403); // owner role must survive accepting their own invite
  await pool.query(
    "UPDATE memberships SET role='owner' WHERE patient_id=$1 AND user_id='11111111-1111-4111-a111-111111111111'",
    [patient],
  );
  const expired = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO invitations VALUES($1,$2,$3,'demo@example.invalid','editor',now()-interval '1 minute',NULL,NULL)",
    [randomUUID(), patient, createHash("sha256").update(expired).digest("hex")],
  );
  expect(
    (
      await request("/invitations/accept", "POST", {
        token: expired,
        agreed: true,
      })
    ).status,
  ).toBe(403);
});
it("photo reads require patient membership and uploads reject unsupported bodies", async () => {
  expect((await request("/photos/" + randomUUID())).status).toBe(404);
  const med = randomUUID();
  await pool.query(
    "INSERT INTO medications(id,patient_id,data) VALUES($1,$2,$3)",
    [med, patient, { name: "Synthetic photo test" }],
  );
  const r = await request(
    "/patients/" + patient + "/photos?medicationId=" + med,
    "POST",
    { bad: "image" },
  );
  expect(r.status).toBe(422);
  const oversized = await fetch(
    base + "/api/patients/" + patient + "/photos?medicationId=" + med,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "image/jpeg",
      },
      body: Buffer.alloc(2 * 1024 * 1024 + 1),
    },
  );
  expect(oversized.status).toBe(413);
  const bytes = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#abcdef" },
  })
    .jpeg()
    .toBuffer();
  const photoId = randomUUID();
  const upload = await fetch(
    base +
      "/api/patients/" +
      patient +
      "/photos?medicationId=" +
      med +
      "&photoId=" +
      photoId,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "image/jpeg",
      },
      body: bytes,
    },
  );
  expect(upload.status).toBe(200);
  const file = await request("/photos/" + photoId);
  expect(file.status).toBe(200);
  expect(file.headers.get("content-type")).toContain("image/jpeg");
  const exported = await (await request("/account/export", "POST", {})).json();
  expect(exported.photoFiles.find((p: any) => p.id === photoId).base64).toMatch(
    /^\/9j\//,
  );
  await pool.query("DELETE FROM photos WHERE id=$1", [photoId]);
  await pool.query("DELETE FROM medications WHERE id=$1", [med]);
});
it("subscription ownership blocks stolen endpoint registration", async () => {
  const actor = randomUUID(),
    device = randomUUID(),
    sub = randomUUID(),
    endpoint = "https://fcm.googleapis.com/stolen-test";
  await pool.query("INSERT INTO users(id) VALUES($1)", [actor]);
  await pool.query(
    "INSERT INTO devices(id,user_id,label) VALUES($1,$2,'Synthetic other account')",
    [device, actor],
  );
  await pool.query(
    "INSERT INTO push_subscriptions(id,device_id,endpoint_hash,data) VALUES($1,$2,$3,$4)",
    [
      sub,
      device,
      createHash("sha256").update(endpoint).digest("hex"),
      seal({ endpoint }),
    ],
  );
  const r = await request("/push-subscriptions", "POST", {
    deviceId: randomUUID(),
    patientId: patient,
    label: "My device",
    consent: true,
    subscription: {
      endpoint,
      keys: { p256dh: "a".repeat(88), auth: "a".repeat(22) },
    },
  });
  expect(r.status).toBe(403);
  await pool.query("DELETE FROM push_subscriptions WHERE id=$1", [sub]);
  await pool.query("DELETE FROM devices WHERE id=$1", [device]);
  await pool.query("DELETE FROM users WHERE id=$1", [actor]);
});
it("symmetric subscription encryption round-trips and detects tampering", () => {
  process.env.PUSH_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const v = seal({
    endpoint: "https://fcm.googleapis.com/private",
    keys: { auth: "secret" },
  });
  expect(JSON.stringify(v)).not.toContain("secret");
  expect(unseal(v).keys.auth).toBe("secret");
  expect(() =>
    unseal({ ...v, tag: randomBytes(16).toString("base64") }),
  ).toThrow();
  delete process.env.PUSH_ENCRYPTION_KEY;
});
it("failed migration transaction rolls back completely", async () => {
  const table = "failed_migration_" + randomUUID().replaceAll("-", "");
  await expect(
    transaction(async (c) => {
      await c.query("CREATE TABLE " + table + "(id integer)");
      await c.query("SELECT nonexistent_column FROM " + table);
    }),
  ).rejects.toThrow();
  expect(
    (await pool.query("SELECT to_regclass($1) table", [table])).rows[0].table,
  ).toBeNull();
});
