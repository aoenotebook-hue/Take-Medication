import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
const origin = process.env.PUBLIC_APP_URL;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!origin?.startsWith("https://") || !url || !key || !publicKey)
  throw new Error(
    "Configure PUBLIC_APP_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY",
  );
const admin = createClient(url, key, { auth: { persistSession: false } });
const browser = createClient(url, publicKey, {
  auth: { persistSession: false },
});
const email = "deployment-check-" + randomUUID() + "@example.invalid";
const password = randomBytes(32).toString("base64url");
let userId = "",
  token = "";
const call = (
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  auth = token,
) =>
  fetch(origin + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + auth,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  });
try {
  for (const path of ["/", "/manifest.webmanifest", "/sw.js"])
    assert.equal((await fetch(origin + path)).status, 200, "PWA asset failed");
  const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
  assert.equal(
    manifest.display,
    "standalone",
    "Manifest fallback returned the wrong content",
  );
  const sw = await fetch(origin + "/sw.js");
  assert.match(
    sw.headers.get("content-type") || "",
    /javascript/,
    "Service worker did not have JavaScript MIME type",
  );
  assert.equal(
    (await call("/patients")).status,
    401,
    "Unauthenticated access allowed",
  );
  assert.equal(
    (await call("/demo", {})).status,
    403,
    "Production demo authentication enabled",
  );
  assert.equal(
    (await call("/internal/reminders", {})).status,
    401,
    "Scheduler exposed",
  );
  const health = await call("/health");
  assert.equal(health.status, 200, "Database health failed");
  assert.equal((await health.json()).adapter, "webpush");
  // A direct Supabase account (not phone + PIN) must not reach the API.
  const directUser = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (directUser.error || !directUser.data.user)
    throw new Error("Synthetic auth identity creation failed");
  const directSession = await browser.auth.signInWithPassword({
    email,
    password,
  });
  if (directSession.error || !directSession.data.session)
    throw new Error("Managed sign-in failed");
  token = directSession.data.session.access_token;
  assert.equal(
    (await call("/patients")).status,
    401,
    "Non-PIN account reached the API",
  );
  await admin.auth.admin.deleteUser(directUser.data.user.id);
  token = "";
  // Real sign-in path: synthetic, unassigned-looking phone number + PIN.
  const phone = "+66" + "9" + String(Date.now()).slice(-8);
  const registered = await call("/auth/pin/register", {
    phone,
    pin: "2580",
  });
  assert.equal(registered.status, 200, "Phone + PIN registration failed");
  const session = await registered.json();
  userId = session.user_id;
  token = session.access_token;
  assert.equal(
    (await call("/auth/pin/login", { phone, pin: "1111" })).status,
    401,
    "Wrong PIN accepted",
  );
  const createdProfile = await call("/patients", {
    displayName: "Synthetic deployment check",
    language: "en",
    timezone: "Asia/Bangkok",
    allergyStatus: "unknown",
    allergies: [],
  });
  assert.equal(createdProfile.status, 200, "Profile creation failed");
  const { id: patientId } = await createdProfile.json();
  assert.equal(
    (await call("/patients/" + patientId + "/snapshot")).status,
    200,
  );
  assert.equal(
    (await call("/patients/" + randomUUID() + "/snapshot")).status,
    403,
    "Patient access isolation failed",
  );
  const medicationId = randomUUID(),
    deviceId = randomUUID();
  const operation = {
    id: randomUUID(),
    deviceId,
    patientId,
    resourceId: medicationId,
    kind: "medication",
    baseVersion: 0,
    clientAt: new Date().toISOString(),
    data: {
      name: "Synthetic deployment medicine",
      generic: "",
      brand: "",
      strength: "Synthetic label",
      form: "tablet",
      route: "oral",
      purpose: "Test only",
      productType: "prescription",
      source: "synthetic",
      verified: false,
    },
  };
  for (let n = 0; n < 2; n++) {
    const r = await call("/sync/push", { operations: [operation] });
    assert.equal(r.status, 200, "Medication sync failed");
    const results = await r.json();
    assert.equal(
      results.results?.[0]?.status,
      "acknowledged",
      "Operation was not acknowledged",
    );
  }
  const photoId = randomUUID();
  const photo = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#abcdef" },
  })
    .jpeg()
    .toBuffer();
  const uploaded = await fetch(
    origin +
      "/api/patients/" +
      patientId +
      "/photos?medicationId=" +
      medicationId +
      "&photoId=" +
      photoId,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "image/jpeg",
      },
      body: photo,
    },
  );
  assert.equal(uploaded.status, 200, "Private photo upload failed");
  assert.equal(
    (await call("/photos/" + photoId)).status,
    200,
    "Private photo read failed",
  );
  assert.equal(
    (await call("/photos/" + photoId, undefined, "GET", "")).status,
    401,
  );
  const publicPhoto = await fetch(
    url +
      "/storage/v1/object/public/medication-photos/" +
      patientId +
      "/" +
      photoId +
      ".jpg",
  );
  assert.notEqual(
    publicPhoto.status,
    200,
    "Private photo was publicly accessible",
  );
  const authenticated = createClient(url, publicKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const direct = await authenticated.from("patients").select("id");
  assert.ok(
    direct.error || direct.data?.length === 0,
    "Direct database access bypassed the API",
  );
  const directPhoto = await authenticated.storage
    .from("medication-photos")
    .download(patientId + "/" + photoId + ".jpg");
  assert.ok(
    directPhoto.error,
    "Direct browser storage access bypassed the API",
  );
  const exported = await call("/account/export", {});
  assert.equal(exported.status, 200, "Account export failed");
  assert.ok(
    (await exported.json()).photoFiles.some((p: any) => p.id === photoId),
    "Photo missing from export",
  );
  const deleted = await call("/account", { confirm: "DELETE" }, "DELETE");
  assert.equal(deleted.status, 200, "Account deletion failed");
  console.log(
    "Live checks passed: PWA assets, auth, patient isolation, idempotent sync, private photos, export, and deletion.",
  );
  console.log(
    "Email OTP delivery and physical iPhone notification display require a separate device/mailbox check.",
  );
} catch (e) {
  console.error(
    e instanceof assert.AssertionError
      ? e.message
      : "Live check failed; inspect provider/API errors without exposing credentials.",
  );
  process.exitCode = 1;
} finally {
  if (token)
    await call("/account", { confirm: "DELETE" }, "DELETE").catch(
      () => undefined,
    );
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}
