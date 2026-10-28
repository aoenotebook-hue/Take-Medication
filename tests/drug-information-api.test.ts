import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { pool } from "../db/client";
import { identityKey } from "../packages/domain/src/drug-information";
let server: Server, base: string, token: string;
const actor = "11111111-1111-4111-a111-111111111111",
  patient = randomUUID(),
  med = randomUUID();
const data = {
  name: "Metformin",
  generic: "metformin",
  strength: "500 mg",
  form: "tablet",
  route: "oral",
  purpose: "Private prescriber note",
  productType: "prescription",
  verified: false,
};
async function call(suffix: string, body?: unknown, auth = token) {
  return fetch(
    base +
      "/api/patients/" +
      patient +
      "/medications/" +
      med +
      "/information" +
      suffix,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: auth ? "Bearer " + auth : "",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}
beforeAll(async () => {
  process.env.LOCAL_DEMO = "true";
  process.env.VITEST = "true";
  const { app } = await import("../apps/api/src/server");
  token = await (await import("../apps/api/src/auth")).demoToken();
  await pool.query("INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING", [
    actor,
  ]);
  await pool.query(
    "INSERT INTO patients(id,owner_id,data) VALUES($1,$2,'{}')",
    [patient, actor],
  );
  await pool.query("INSERT INTO memberships VALUES($1,$2,'owner',NULL)", [
    patient,
    actor,
  ]);
  await pool.query(
    "INSERT INTO medications(id,patient_id,data) VALUES($1,$2,$3)",
    [med, patient, data],
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = "http://127.0.0.1:" + (server.address() as any).port;
});
afterAll(async () => {
  server?.close();
  for (const table of [
    "medication_information_matches",
    "audit_events",
    "change_feed",
    "medications",
    "memberships",
    "patients",
  ])
    await pool.query(
      `DELETE FROM ${table} WHERE ${table === "patients" ? "id" : "patient_id"}=$1`,
      [patient],
    );
  await pool.end();
});
it("authorizes lookup, saves a separate association, and preserves all medicine instructions", async () => {
  expect((await call("", undefined, "")).status).toBe(401);
  const r = await call("/search", { query: "metformin", remote: false });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect((await r.json()).cards[0].uses.th).toContain("เบาหวาน");
  const save = await call("/match", {
    id: "catalog:metformin",
    identityKey: identityKey(data),
    confirmed: true,
  });
  expect(save.status).toBe(200);
  expect((await (await call("")).json()).state).toBe("matched");
  expect(
    (await pool.query("SELECT data FROM medications WHERE id=$1", [med]))
      .rows[0].data,
  ).toEqual(data);
});
it("rejects malformed queries, arbitrary URLs, unconfirmed and stale identity selections", async () => {
  expect((await call("/search", { query: "x".repeat(101) })).status).toBe(422);
  expect(
    (await call("/search", { query: "metformin", patientName: "private" }))
      .status,
  ).toBe(422);
  expect(
    (
      await call("/match", {
        id: "https://evil.invalid",
        identityKey: identityKey(data),
        confirmed: true,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("/match", {
        id: "catalog:metformin",
        identityKey: identityKey(data),
        confirmed: false,
      })
    ).status,
  ).toBe(422);
  const changed = { ...data, strength: "1000 mg" };
  await pool.query("UPDATE medications SET data=$2 WHERE id=$1", [
    med,
    changed,
  ]);
  expect((await (await call("")).json()).state).toBe("needs-review");
  expect(
    (
      await call("/match", {
        id: "catalog:metformin",
        identityKey: identityKey(data),
        confirmed: true,
      })
    ).status,
  ).toBe(409);
  await pool.query("UPDATE medications SET data=$2 WHERE id=$1", [med, data]);
});
it("permits viewer reading/search, denies writes, and denies revoked/outsider access", async () => {
  await pool.query("UPDATE memberships SET role='viewer' WHERE patient_id=$1", [
    patient,
  ]);
  expect((await call("/search", { query: "metformin" })).status).toBe(200);
  expect(
    (
      await call("/match", {
        id: "catalog:metformin",
        identityKey: identityKey(data),
        confirmed: true,
      })
    ).status,
  ).toBe(403);
  await pool.query(
    "UPDATE memberships SET revoked_at=now() WHERE patient_id=$1",
    [patient],
  );
  expect((await call("")).status).toBe(403);
  expect((await call("/search", { query: "metformin" })).status).toBe(403);
  await pool.query(
    "UPDATE memberships SET role='owner',revoked_at=NULL WHERE patient_id=$1",
    [patient],
  );
  const other = await fetch(
    base +
      "/api/patients/" +
      randomUUID() +
      "/medications/" +
      med +
      "/information",
    { headers: { Authorization: "Bearer " + token } },
  );
  expect(other.status).toBe(403);
});
it("automatically looks up a medicine without changing instructions and obeys the opt-out", async () => {
  const url = base + "/api/patients/" + patient + "/drug-information/refresh";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ medicationIds: [med] }),
  });
  expect(r.status).toBe(200);
  expect((await r.json()).automaticInformation[0].card.shortUses.en).toBe(
    "Lowers blood sugar",
  );
  expect(
    (await pool.query("SELECT data FROM medications WHERE id=$1", [med]))
      .rows[0].data,
  ).toEqual(data);
  await pool.query(
    "UPDATE patients SET data='{" +
      '"automaticDrugInformation":false' +
      "}' WHERE id=$1",
    [patient],
  );
  const off = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ medicationIds: [med] }),
  });
  expect((await off.json()).automaticInformation).toEqual([]);
});
it("returns a bounded authorized monthly report and denies other patients", async () => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO dose_occurrences(id,patient_id,medication_id,slot_id,local_date,local_time,timezone,intended_at,data) VALUES($1,$2,$3,'report',current_date,'00:00','Asia/Bangkok',now()-interval '1 minute','{}')",
    [id, patient, med],
  );
  const month = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const r = await fetch(
    base + "/api/patients/" + patient + "/monthly-report?month=" + month,
    { headers: { Authorization: "Bearer " + token } },
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect((await r.json()).totals).toMatchObject({
    scheduled: 1,
    unconfirmed: 1,
    takenPercent: 0,
    notRecordedPercent: 100,
  });
  const denied = await fetch(
    base + "/api/patients/" + randomUUID() + "/monthly-report?month=" + month,
    { headers: { Authorization: "Bearer " + token } },
  );
  expect(denied.status).toBe(403);
  await pool.query("DELETE FROM dose_occurrences WHERE id=$1", [id]);
});
