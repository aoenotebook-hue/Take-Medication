import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { pool } from "../db/client";
import { applyOperation, snapshot, authorize } from "../apps/api/src/service";
import {
  refreshHorizon,
  enqueueJobs,
  dispatchOne,
} from "../apps/worker/src/worker";
import { validateEndpoint } from "../apps/worker/src/push";
import { projectDose } from "../packages/domain/src";
const owner = randomUUID(),
  editor = randomUUID(),
  viewer = randomUUID(),
  outsider = randomUUID(),
  patient = randomUUID(),
  med = randomUUID();
const instruction = {
  status: "active",
  instructions: "Synthetic original label",
  food: "Copied food text",
  route: "oral",
  timezone: "Asia/Bangkok",
  start: DateTime.now().setZone("Asia/Bangkok").minus({ days: 1 }).toISODate(),
  slots: [
    {
      id: "am",
      time: DateTime.now()
        .setZone("Asia/Bangkok")
        .minus({ minutes: 1 })
        .toFormat("HH:mm"),
      amount: "0.5",
      unit: "tablet",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
  ],
  confirmed: true,
  source: "synthetic",
  reason: "initial",
  effectiveAt: DateTime.utc().minus({ days: 1 }).toISO(),
};
const medication = {
  name: "Synthetic medicine",
  generic: "",
  brand: "",
  strength: "5 mg + 10 mg (original)",
  form: "tablet",
  route: "oral",
  purpose: "Test only",
  productType: "prescription",
  source: "synthetic",
  verified: false,
};
const op = (
  kind: string,
  resourceId: string,
  baseVersion: number,
  data: any,
) => ({
  id: randomUUID(),
  deviceId: randomUUID(),
  patientId: patient,
  resourceId,
  baseVersion,
  kind,
  data,
  clientAt: new Date().toISOString(),
});
let occurrence: any, device: string, subscription: string;
beforeAll(async () => {
  for (const id of [owner, editor, viewer, outsider])
    await pool.query("INSERT INTO users(id) VALUES($1)", [id]);
  await pool.query("INSERT INTO patients(id,owner_id,data) VALUES($1,$2,$3)", [
    patient,
    owner,
    {
      displayName: "Synthetic integration",
      language: "en",
      timezone: "Asia/Bangkok",
      allergyStatus: "unknown",
      allergies: [],
    },
  ]);
  for (const [user, role] of [
    [owner, "owner"],
    [editor, "editor"],
    [viewer, "viewer"],
  ])
    await pool.query("INSERT INTO memberships VALUES($1,$2,$3,NULL)", [
      patient,
      user,
      role,
    ]);
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});
describe("PostgreSQL authorization and transactions", () => {
  it("rejects identifier tampering, viewer writes and role escalation", async () => {
    await expect(authorize(pool, outsider, patient)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      authorize(pool, viewer, patient, "editor"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authorize(pool, editor, patient, "owner"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("idempotent operations do not duplicate records", async () => {
    const o = op("medication", med, 0, medication);
    const first = await applyOperation(owner, o);
    expect(await applyOperation(owner, o)).toEqual(first);
    expect(
      (await pool.query("SELECT * FROM medications WHERE id=$1", [med]))
        .rowCount,
    ).toBe(1);
  });
  it("regimens create immutable occurrence identities", async () => {
    await applyOperation(owner, op("regimen", med, 1, instruction));
    const s = await snapshot(owner, patient);
    occurrence = s.occurrences.find(
      (o) =>
        o.intended_at <= new Date() &&
        o.intended_at > new Date(Date.now() - 900000),
    );
    expect(occurrence).toBeTruthy();
    // The Today screen compares this calendar day with a "YYYY-MM-DD" string.
    expect(occurrence.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(
      pool.query(
        "UPDATE regimen_versions SET data=data WHERE medication_id=$1",
        [med],
      ),
    ).rejects.toThrow("append-only");
  });
  it("future-effective changes preserve earlier history and reject stale version/overlap", async () => {
    const old = occurrence.id;
    await applyOperation(
      editor,
      op("regimen", med, 2, {
        ...instruction,
        effectiveAt: DateTime.utc().plus({ days: 2 }).toISO(),
        reason: "future change",
        slots: [{ ...instruction.slots[0], amount: "1/2" }],
      }),
    );
    const s = await snapshot(owner, patient);
    expect(s.occurrences.find((o) => o.id === old)?.valid).toBe(true);
    await expect(
      applyOperation(owner, op("regimen", med, 2, instruction)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      applyOperation(owner, op("regimen", med, 3, instruction)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("double tap dedup, independent device conflict, resolution and undo", async () => {
    const data = {
      occurrenceId: occurrence.id,
      medicationId: med,
      action: "taken",
      baseEventIds: [],
      actualAt: new Date().toISOString(),
    };
    const a = op("dose", occurrence.id, 0, data);
    await applyOperation(owner, a);
    await applyOperation(owner, a);
    const b = op("dose", occurrence.id, 0, { ...data, action: "skipped" });
    await applyOperation(editor, b);
    const { projectDose } = await import("../packages/domain/src");
    let s = await snapshot(owner, patient);
    expect(
      projectDose(s.events.filter((e) => e.occurrence_id === occurrence.id))
        .status,
    ).toBe("conflict");
    const r = op("dose", occurrence.id, 0, {
      ...data,
      action: "resolve",
      status: "taken",
      baseEventIds: [a.id, b.id],
    });
    await applyOperation(owner, r);
    const u = op("dose", occurrence.id, 0, {
      ...data,
      action: "undo",
      baseEventIds: [r.id],
    });
    await applyOperation(owner, u);
    s = await snapshot(owner, patient);
    expect(s.events.filter((e) => e.id === a.id)).toHaveLength(1);
    expect(
      projectDose(s.events.filter((e) => e.occurrence_id === occurrence.id))
        .status,
    ).toBe("unconfirmed");
  });
  it("as-needed uses a separate event and no invented occurrence", async () => {
    const prn = randomUUID();
    await applyOperation(
      owner,
      op("medication", prn, 0, { ...medication, name: "Synthetic PRN" }),
    );
    await applyOperation(
      owner,
      op("regimen", prn, 1, { ...instruction, status: "as-needed", slots: [] }),
    );
    await applyOperation(
      owner,
      op("dose", prn, 0, {
        occurrenceId: null,
        medicationId: prn,
        action: "as-needed",
        baseEventIds: [],
        actualAt: new Date().toISOString(),
      }),
    );
    expect(
      (await snapshot(owner, patient)).events.some(
        (e) => e.action === "as-needed" && !e.occurrence_id,
      ),
    ).toBe(true);
  });
  it("requires explicit backdating, prohibits future confirmation, bounds snoozes", async () => {
    const hist = randomUUID();
    await applyOperation(
      owner,
      op("medication", hist, 0, {
        ...medication,
        name: "Synthetic historical test",
      }),
    );
    await applyOperation(
      owner,
      op("regimen", hist, 1, {
        ...instruction,
        start: DateTime.now()
          .setZone("Asia/Bangkok")
          .minus({ days: 10 })
          .toISODate(),
        effectiveAt: DateTime.utc().minus({ days: 10 }).toISO(),
      }),
    );
    const snap = await snapshot(owner, patient);
    const old = snap.occurrences.find(
      (o) =>
        o.medication_id === hist &&
        o.intended_at < new Date(Date.now() - 86400000),
    );
    expect(old).toBeTruthy();
    const event = {
      occurrenceId: old.id,
      medicationId: hist,
      action: "taken",
      baseEventIds: [],
      actualAt: new Date().toISOString(),
    };
    await expect(
      applyOperation(owner, op("dose", old.id, 0, event)),
    ).rejects.toMatchObject({ status: 422 });
    await applyOperation(
      owner,
      op("dose", old.id, 0, { ...event, backdateConfirmed: true }),
    );
    const future = snap.occurrences.find(
      (o) => o.medication_id === hist && o.intended_at > new Date(),
    );
    await expect(
      applyOperation(
        owner,
        op("dose", future.id, 0, { ...event, occurrenceId: future.id }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    // A dose that is not due yet cannot be snoozed (no reminder floods).
    await expect(
      applyOperation(
        owner,
        op("snooze", future.id, 0, { occurrenceId: future.id, minutes: 10 }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    // "Remind me later" must stay inside the window after the dose time.
    process.env.SNOOZE_WINDOW_MINUTES = "1";
    await expect(
      applyOperation(
        owner,
        op("snooze", occurrence.id, 0, {
          occurrenceId: occurrence.id,
          minutes: 30,
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    delete process.env.SNOOZE_WINDOW_MINUTES;
    // 15 minutes is allowed (longer than the first reminder's window).
    await applyOperation(
      owner,
      op("snooze", occurrence.id, 0, {
        occurrenceId: occurrence.id,
        minutes: 15,
      }),
    );
    // Up to six repeats in total.
    for (let i = 0; i < 5; i++)
      await applyOperation(
        owner,
        op("snooze", occurrence.id, 0, {
          occurrenceId: occurrence.id,
          minutes: 10,
        }),
      );
    await expect(
      applyOperation(
        owner,
        op("snooze", occurrence.id, 0, {
          occurrenceId: occurrence.id,
          minutes: 10,
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      applyOperation(
        owner,
        op("snooze", old.id, 0, { occurrenceId: old.id, minutes: 30 }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("revoked membership immediately blocks reads", async () => {
    await pool.query(
      "UPDATE memberships SET revoked_at=now() WHERE patient_id=$1 AND user_id=$2",
      [patient, viewer],
    );
    await expect(snapshot(viewer, patient)).rejects.toMatchObject({
      status: 403,
    });
  });
});
describe("Durable queue", () => {
  beforeAll(async () => {
    device = randomUUID();
    subscription = randomUUID();
    await pool.query("INSERT INTO devices(id,user_id,label) VALUES($1,$2,$3)", [
      device,
      owner,
      "Synthetic CI",
    ]);
    await pool.query(
      "INSERT INTO push_subscriptions(id,device_id,endpoint_hash,data) VALUES($1,$2,$3,$4)",
      [
        subscription,
        device,
        randomUUID(),
        {
          endpoint: "https://fcm.googleapis.com/test",
          keys: { p256dh: "synthetic", auth: "synthetic" },
        },
      ],
    );
    await pool.query("INSERT INTO reminder_preferences VALUES($1,$2,true)", [
      patient,
      device,
    ]);
  });
  it("isolates DST-gap schedules so other patients keep their horizons", async () => {
    const gap = randomUUID(),
      healthy = randomUUID();
    for (const id of [gap, healthy]) {
      await applyOperation(
        owner,
        op("medication", id, 0, { ...medication, name: "Synthetic DST " + id }),
      );
      await applyOperation(
        owner,
        op("regimen", id, 1, {
          ...instruction,
          start: "2026-01-01",
          effectiveAt: "2026-01-01T00:00:00Z",
          timezone: id === gap ? "America/New_York" : "UTC",
          slots: [
            { ...instruction.slots[0], time: id === gap ? "02:30" : "08:00" },
          ],
        }),
      );
    }
    const fixed = DateTime.utc(2026, 3, 1) as DateTime<true>;
    const clock = vi.spyOn(DateTime, "utc").mockImplementation(() => fixed);
    try {
      await refreshHorizon();
    } finally {
      clock.mockRestore();
    }
    expect(
      (
        await pool.query(
          "SELECT reason FROM schedule_issues WHERE medication_id=$1",
          [gap],
        )
      ).rows[0].reason,
    ).toBe("DST_GAP_REVIEW");
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM dose_occurrences WHERE medication_id=$1 AND local_date BETWEEN '2026-03-01' AND '2026-03-31'",
          [healthy],
        )
      ).rows[0].count,
    ).toBe("31");
  });
  it("overlapping schedulers create unique jobs", async () => {
    await refreshHorizon();
    await Promise.all([enqueueJobs(), enqueueJobs()]);
    const rows = (
      await pool.query(
        "SELECT * FROM reminder_jobs WHERE subscription_id=$1 AND due_at<=now()",
        [subscription],
      )
    ).rows;
    expect(rows).toHaveLength(1);
  });
  it("overlapping workers claim once and name the medicines due", async () => {
    let sent = 0;
    const sender = async (_s: any, p: any, ttl: number) => {
      sent++;
      // The neutral fallback text stays neutral; the details name what is due.
      expect(p.body).not.toContain("Synthetic");
      expect(p.detail.title).toMatch(/^Medicine time · \w+ \d\d:\d\d$/);
      expect(p.detail.body).toMatch(/^• Synthetic/);
      expect(ttl).toBeGreaterThan(0);
      return { statusCode: 201 };
    };
    await Promise.all([
      dispatchOne(new Date(), sender),
      dispatchOne(new Date(), sender),
    ]);
    expect(sent).toBe(1);
  });
  it("a snoozed reminder repeats once for every medicine still due then", async () => {
    const second = randomUUID();
    await applyOperation(
      owner,
      op("medication", second, 0, { ...medication, name: "Synthetic second" }),
    );
    await applyOperation(owner, op("regimen", second, 1, instruction));
    const snap = await snapshot(owner, patient);
    const sibling = snap.occurrences.find(
      (o: any) =>
        o.medication_id === second &&
        o.intended_at.getTime() === occurrence.intended_at.getTime(),
    );
    expect(sibling).toBeTruthy();
    const firstOpen =
      projectDose(
        snap.events.filter((e: any) => e.occurrence_id === occurrence.id),
      ).status === "unconfirmed";
    const later = op("snooze", sibling.id, 0, {
      occurrenceId: sibling.id,
      minutes: 15,
    });
    await applyOperation(owner, later);
    const job = (
      await pool.query("SELECT * FROM reminder_jobs WHERE kind=$1", [
        "snooze-" + later.id,
      ])
    ).rows[0];
    expect(job.occurrence_ids).toContain(sibling.id);
    expect(job.occurrence_ids.includes(occurrence.id)).toBe(firstOpen);
    expect(job.expires_at.getTime() - job.due_at.getTime()).toBe(900000);
    const sent: any[] = [];
    for (let i = 0; i < 20; i++)
      if (
        !(await dispatchOne(
          new Date(Date.now() + 16 * 60000),
          async (_s, p) => {
            sent.push(p);
            return { statusCode: 201 };
          },
        ))
      )
        break;
    const repeat = sent.find((p) => p.id === job.id);
    expect(repeat.snooze).toBe(true);
    expect(repeat.detail.title).toMatch(/^Medicine time \(reminder\) · /);
    expect(repeat.detail.body).toContain("Synthetic second");
  });
  it("lease recovery and expired jobs never replay backlog", async () => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,kind,due_at,expires_at,state,lease_until) VALUES($1::uuid,$2,$3,$1::text,'test','[]','test',now()-interval '1 minute',now()+interval '10 minutes','leased',now()-interval '1 second')",
      [id, patient, subscription],
    );
    let sent = 0;
    await dispatchOne(new Date(), async () => {
      sent++;
      return { statusCode: 201 };
    });
    expect(sent).toBe(1);
    const expired = randomUUID();
    await pool.query(
      "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,kind,due_at,expires_at) VALUES($1::uuid,$2,$3,$1::text,'expired','[]','test',now()-interval '1 hour',now()-interval '30 minutes')",
      [expired, patient, subscription],
    );
    await dispatchOne(new Date(), async () => {
      throw Error("Should not send expired");
    });
    expect(
      (
        await pool.query("SELECT state FROM reminder_jobs WHERE id=$1", [
          expired,
        ])
      ).rows[0].state,
    ).toBe("expired");
  });
  it("invalid endpoint rejects SSRF, paths with allowed-provider hosts accepted", () => {
    for (const url of [
      "http://fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://user:pass@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:444/x",
    ])
      expect(() => validateEndpoint(url)).toThrow();
    expect(() =>
      validateEndpoint("https://web.push.apple.com/opaque"),
    ).not.toThrow();
  });
  it("404/410 disables subscription and does not retry", async () => {
    await pool.query(
      "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,kind,due_at,expires_at) VALUES($1::uuid,$2,$3,$1::text,'410','[]','test',now()-interval '1 second',now()+interval '10 minutes')",
      [randomUUID(), patient, subscription],
    );
    await dispatchOne(new Date(), async () => {
      throw { statusCode: 410 };
    });
    expect(
      (
        await pool.query(
          "SELECT disabled_at FROM push_subscriptions WHERE id=$1",
          [subscription],
        )
      ).rows[0].disabled_at,
    ).toBeTruthy();
  });
  it("rate-limited transport retries respect Retry-After and freshness", async () => {
    await pool.query(
      "UPDATE push_subscriptions SET disabled_at=NULL WHERE id=$1",
      [subscription],
    );
    const id = randomUUID();
    await pool.query(
      "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,kind,due_at,expires_at) VALUES($1::uuid,$2,$3,$1::text,'retry','[]','test',now()-interval '1 second',now()+interval '10 minutes')",
      [id, patient, subscription],
    );
    const before = Date.now();
    await dispatchOne(new Date(), async () => {
      throw { statusCode: 429, headers: { "retry-after": "2" } };
    });
    const job = (
      await pool.query("SELECT * FROM reminder_jobs WHERE id=$1", [id])
    ).rows[0];
    expect(job.state).toBe("queued");
    expect(job.retry_at.getTime()).toBeGreaterThanOrEqual(before + 2000);
    expect(job.retry_at < job.expires_at).toBe(true);
    await pool.query("UPDATE reminder_jobs SET state='cancelled' WHERE id=$1", [
      id,
    ]);
  });
  it("pause/stop cancels unsent future jobs without deleting history", async () => {
    const futureBefore = (await snapshot(owner, patient)).occurrences.filter(
      (o) => o.valid && o.intended_at > new Date(),
    ).length;
    await applyOperation(
      owner,
      op("regimen", med, 3, {
        ...instruction,
        status: "stopped",
        effectiveAt: DateTime.utc().plus({ days: 3 }).toISO(),
        reason: "stop",
      }),
    );
    const s = await snapshot(owner, patient);
    expect(s.events.length).toBeGreaterThan(0);
    expect(
      s.occurrences.filter(
        (o) =>
          o.valid &&
          o.medication_id === med &&
          o.intended_at > new Date(Date.now() + 4 * 86400000),
      ),
    ).toHaveLength(0);
    expect(futureBefore).toBeGreaterThan(0);
  });
  it("new dose records cannot attach to a replaced or stopped dose time", async () => {
    const stale = (
      await pool.query(
        "SELECT id FROM dose_occurrences WHERE medication_id=$1 AND NOT valid AND intended_at>now() LIMIT 1",
        [med],
      )
    ).rows[0];
    expect(stale).toBeTruthy();
    await expect(
      applyOperation(
        owner,
        op("dose", stale.id, 0, {
          occurrenceId: stale.id,
          medicationId: med,
          action: "skipped",
          baseEventIds: [],
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "Occurrence replaced or stopped",
    });
    expect(
      (
        await pool.query("SELECT 1 FROM dose_events WHERE occurrence_id=$1", [
          stale.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
});

async function cleanup() {
  await pool.query(
    "DELETE FROM push_observations WHERE job_id IN (SELECT id FROM reminder_jobs WHERE patient_id=$1)",
    [patient],
  );
  await pool.query(
    "DELETE FROM push_attempts WHERE job_id IN (SELECT id FROM reminder_jobs WHERE patient_id=$1)",
    [patient],
  );
  await pool.query(
    "DELETE FROM regimen_supersessions WHERE regimen_id IN (SELECT id FROM regimen_versions WHERE patient_id=$1)",
    [patient],
  );
  for (const table of [
    "reminder_jobs",
    "reminder_preferences",
    "snoozes",
    "dose_events",
    "dose_occurrences",
    "photos",
    "regimen_versions",
    "schedule_issues",
    "medications",
    "invitations",
    "audit_events",
    "change_feed",
    "memberships",
  ])
    await pool.query("DELETE FROM " + table + " WHERE patient_id=$1", [
      patient,
    ]);
  await pool.query("DELETE FROM patients WHERE id=$1", [patient]);
  await pool.query(
    "DELETE FROM push_subscriptions WHERE device_id IN (SELECT id FROM devices WHERE user_id=ANY($1::uuid[]))",
    [[owner, editor, viewer, outsider]],
  );
  await pool.query("DELETE FROM devices WHERE user_id=ANY($1::uuid[])", [
    [owner, editor, viewer, outsider],
  ]);
  await pool.query(
    "DELETE FROM sync_operations WHERE actor_id=ANY($1::uuid[])",
    [[owner, editor, viewer, outsider]],
  );
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner, editor, viewer, outsider],
  ]);
}
