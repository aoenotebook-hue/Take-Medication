import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../db/client";
import {
  cronAuthorized,
  runReminderBatch,
} from "../apps/worker/src/serverless";
import { PostgresRateStore } from "../apps/api/src/rate-store";
import { DateTime } from "luxon";
afterAll(() => pool.end());

it("requires a strong scheduler secret and rejects user tokens and altered headers", () => {
  const secret = "synthetic-" + randomUUID();
  expect(cronAuthorized("Bearer " + secret, secret)).toBe(true);
  expect(cronAuthorized("Bearer " + secret + "x", secret)).toBe(false);
  expect(cronAuthorized("Bearer user-token", secret)).toBe(false);
  expect(cronAuthorized(undefined, secret)).toBe(false);
  expect(cronAuthorized("Bearer short", "short")).toBe(false);
});

it("shares atomic rate counters across instances and resets an expired window", async () => {
  const bucket = "synthetic-" + randomUUID();
  const a = new PostgresRateStore(bucket),
    b = new PostgresRateStore(bucket);
  try {
    const hits = await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        (n % 2 ? a : b).increment("synthetic-ip"),
      ),
    );
    expect(hits.map((h) => h.totalHits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 20 }, (_, n) => n + 1),
    );
    await pool.query(
      "UPDATE api_rate_limits SET reset_at=now()-interval '1 second' WHERE bucket=$1",
      [bucket],
    );
    expect((await b.increment("synthetic-ip")).totalHits).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT key_hash FROM api_rate_limits WHERE bucket=$1",
          [bucket],
        )
      ).rows[0].key_hash,
    ).not.toContain("synthetic-ip");
  } finally {
    await pool.query("DELETE FROM api_rate_limits WHERE bucket=$1", [bucket]);
  }
});

it("skips overlapping scheduler calls and recovers an abandoned invocation", async () => {
  const owner = randomUUID();
  await pool.query(
    "INSERT INTO scheduler_runs VALUES('reminders',$1,now()+interval '1 minute') ON CONFLICT(id) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until",
    [owner],
  );
  try {
    expect((await runReminderBatch(0)).busy).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT lease_owner FROM scheduler_runs WHERE id='reminders'",
        )
      ).rows[0].lease_owner,
    ).toBe(owner);
    await pool.query(
      "UPDATE scheduler_runs SET lease_until=now()-interval '1 second' WHERE id='reminders'",
    );
    expect(await runReminderBatch(0)).toEqual({
      busy: false,
      dispatched: 0,
      refreshed: 0,
    });
    expect(
      (await pool.query("SELECT 1 FROM scheduler_runs WHERE id='reminders'"))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM worker_health WHERE id='worker' AND heartbeat>now()-interval '1 minute'",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await pool.query("DELETE FROM scheduler_runs WHERE id='reminders'");
  }
});

it("denies direct browser-role patient access even when a table grant exists", async () => {
  const role = "synthetic_browser_" + randomUUID().replaceAll("-", "");
  await pool.query(`CREATE ROLE ${role} NOLOGIN`);
  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await pool.query(`GRANT SELECT ON patients TO ${role}`);
    const rows = await transaction(async (c) => {
      await c.query(`SET LOCAL ROLE ${role}`);
      return (await c.query("SELECT * FROM patients")).rows;
    });
    expect(rows).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='public.patients'::regclass",
        )
      ).rows[0].relrowsecurity,
    ).toBe(true);
  } finally {
    await pool.query(`DROP OWNED BY ${role}`);
    await pool.query(`DROP ROLE ${role}`);
  }
});
it("refreshes rolling horizons in a bounded invocation and skips freshly scanned medications", async () => {
  const owner = randomUUID(),
    patient = randomUUID(),
    med = randomUUID(),
    regimen = randomUUID();
  await pool.query("INSERT INTO users(id) VALUES($1)", [owner]);
  await pool.query("INSERT INTO patients(id,owner_id,data) VALUES($1,$2,$3)", [
    patient,
    owner,
    {
      displayName: "Synthetic horizon",
      language: "en",
      timezone: "Asia/Bangkok",
    },
  ]);
  await pool.query(
    "INSERT INTO medications(id,patient_id,data) VALUES($1,$2,$3)",
    [med, patient, { name: "Synthetic horizon medicine" }],
  );
  const data = {
    status: "active",
    timezone: "Asia/Bangkok",
    start: DateTime.now().setZone("Asia/Bangkok").toISODate(),
    instructions: "Synthetic only",
    route: "oral",
    food: "",
    confirmed: true,
    source: "synthetic",
    reason: "initial",
    effectiveAt: new Date().toISOString(),
    slots: [
      {
        id: "night",
        time: "23:55",
        amount: "1",
        unit: "tablet",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    ],
  };
  await pool.query(
    "INSERT INTO regimen_versions(id,patient_id,medication_id,version,effective_at,data,actor_id) VALUES($1,$2,$3,1,now()-interval '1 minute',$4,$5)",
    [regimen, patient, med, data, owner],
  );
  try {
    const batch = await runReminderBatch(15000, async () => ({
      statusCode: 202,
      simulated: true,
    }));
    expect(batch.busy).toBe(false);
    expect(batch.refreshed).toBeGreaterThan(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM dose_occurrences WHERE medication_id=$1",
          [med],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(30);
    const scanned = (
      await pool.query(
        "SELECT checked_at FROM scheduler_scans WHERE medication_id=$1",
        [med],
      )
    ).rows[0].checked_at;
    await runReminderBatch(15000, async () => ({
      statusCode: 202,
      simulated: true,
    }));
    expect(
      (
        await pool.query(
          "SELECT checked_at FROM scheduler_scans WHERE medication_id=$1",
          [med],
        )
      ).rows[0].checked_at,
    ).toEqual(scanned);
  } finally {
    await pool.query("DELETE FROM dose_occurrences WHERE medication_id=$1", [
      med,
    ]);
    await pool.query("DELETE FROM regimen_versions WHERE medication_id=$1", [
      med,
    ]);
    await pool.query("DELETE FROM medications WHERE id=$1", [med]);
    await pool.query("DELETE FROM patients WHERE id=$1", [patient]);
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
  }
});
