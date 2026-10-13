import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
if (process.env.NODE_ENV === "production" || process.env.LOCAL_DEMO !== "true")
  throw new Error(
    "Container smoke check is restricted to the isolated synthetic stack",
  );
const origin = "http://127.0.0.1:3001";
const response = await fetch(origin + "/api/demo", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(response.status, 200);
const token = (await response.json()).token;
async function request(path, body) {
  const r = await fetch(origin + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(r.status, 200, "Unexpected status for " + path);
  return r.json();
}
assert.equal((await fetch(origin + "/api/patients")).status, 401);
for (const path of ["/", "/manifest.webmanifest", "/sw.js", "/icon-192.png"])
  assert.equal((await fetch(origin + path)).status, 200);
const profiles = await request("/patients");
const patient = profiles[0].id,
  med = randomUUID(),
  device = randomUUID(),
  now = new Date(),
  day = now.toISOString().slice(0, 10),
  time = new Date(now.getTime() - 60000).toISOString().slice(11, 16);
function op(kind, baseVersion, data, resourceId = med) {
  return {
    id: randomUUID(),
    deviceId: device,
    patientId: patient,
    resourceId,
    baseVersion,
    kind,
    clientAt: now.toISOString(),
    data,
  };
}
const identity = op("medication", 0, {
  name: "Synthetic container-check medicine",
  generic: "",
  brand: "",
  strength: "Original synthetic label",
  form: "other",
  route: "reference",
  purpose: "Software test only",
  productType: "supplement",
  source: "Synthetic fixture",
  verified: false,
});
const regimen = {
  status: "active",
  instructions: "Synthetic software test instructions; not for treatment",
  food: "Synthetic label",
  route: "reference",
  timezone: "UTC",
  start: day,
  end: day,
  slots: [
    {
      id: randomUUID(),
      time,
      amount: "0.5",
      unit: "test-unit",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
  ],
  confirmed: true,
  source: "Synthetic fixture",
  reason: "Container verification",
  effectiveAt: day + "T00:00:00Z",
};
const version = op("regimen", 1, regimen),
  batch = { operations: [identity, version] };
let result = await request("/sync/push", batch);
assert(result.results.every((r) => r.status === "acknowledged"));
assert.deepEqual(await request("/sync/push", batch), result);
let snapshot = await request("/patients/" + patient + "/snapshot");
const occurrence = snapshot.occurrences.find((o) => o.medication_id === med);
assert(occurrence, "Synthetic scheduled occurrence must exist");
const dose = op(
  "dose",
  0,
  {
    occurrenceId: occurrence.id,
    medicationId: med,
    action: "taken",
    baseEventIds: [],
    actualAt: now.toISOString(),
  },
  occurrence.id,
);
assert.equal(
  (await request("/sync/push", { operations: [dose, dose] })).results[0].status,
  "acknowledged",
);
const stop = op("regimen", 2, {
  ...regimen,
  status: "stopped",
  effectiveMode: "on-commit",
  reason: "Finished synthetic verification",
  effectiveAt: new Date().toISOString(),
});
assert.equal(
  (await request("/sync/push", { operations: [stop] })).results[0].status,
  "acknowledged",
);
snapshot = await request("/patients/" + patient + "/snapshot");
assert.equal(snapshot.events.filter((e) => e.id === dose.id).length, 1);
assert(
  snapshot.regimens.some(
    (r) => r.medication_id === med && r.data.status === "stopped",
  ),
);
const bytes = await sharp({
  create: { width: 40, height: 40, channels: 3, background: "#abcdef" },
})
  .jpeg()
  .toBuffer();
const upload = await fetch(
  origin + "/api/patients/" + patient + "/photos?medicationId=" + med,
  {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "image/jpeg" },
    body: bytes,
  },
);
assert.equal(upload.status, 200);
const photo = (await upload.json()).id;
assert.equal(
  (
    await fetch(origin + "/api/photos/" + photo, {
      headers: { Authorization: "Bearer " + token },
    })
  ).status,
  200,
);
assert.equal((await fetch(origin + "/api/photos/" + photo)).status, 401);
const health = await request("/health");
assert.equal(health.database, "reachable");
assert.equal(health.adapter, "simulated");
assert(health.worker.some((h) => h.heartbeat));
console.log(
  "PASS: container PWA assets, authentication isolation, PostgreSQL writes, replay idempotency, dose history, stop, private photos, worker heartbeat. Synthetic adapter only; live auth/push not tested.",
);
