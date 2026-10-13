import { randomUUID, timingSafeEqual } from "node:crypto";
import { pool, transaction } from "../../../db/client";
import { regenerate } from "../../api/src/service";
import { dispatchOne, enqueueJobs, heartbeat } from "./worker";

export function cronAuthorized(
  header: string | undefined,
  secret = process.env.CRON_SECRET,
) {
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from("Bearer " + secret),
    actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function refreshOne() {
  return transaction(async (c) => {
    const med = (
      await c.query(
        "SELECT m.id,m.patient_id FROM medications m JOIN patients p ON p.id=m.patient_id LEFT JOIN scheduler_scans s ON s.medication_id=m.id WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND (s.checked_at IS NULL OR s.checked_at<now()-interval '12 hours') ORDER BY s.checked_at NULLS FIRST,m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED",
      )
    ).rows[0];
    if (!med) {
      await c.query(
        "INSERT INTO worker_health VALUES('scheduler',now(),now()+interval '30 days') ON CONFLICT(id) DO UPDATE SET heartbeat=now(),horizon_at=excluded.horizon_at",
      );
      return false;
    }
    await c.query("SAVEPOINT medication_horizon");
    try {
      await regenerate(c, med.patient_id, med.id);
      await c.query("DELETE FROM schedule_issues WHERE medication_id=$1", [
        med.id,
      ]);
    } catch (e: any) {
      await c.query("ROLLBACK TO SAVEPOINT medication_horizon");
      if (!e.message?.includes("DST gap")) throw e;
      await c.query(
        "INSERT INTO schedule_issues(medication_id,patient_id,reason) VALUES($1,$2,'DST_GAP_REVIEW') ON CONFLICT(medication_id) DO UPDATE SET recorded_at=now()",
        [med.id, med.patient_id],
      );
    }
    await c.query(
      "INSERT INTO scheduler_scans VALUES($1,now()) ON CONFLICT(medication_id) DO UPDATE SET checked_at=now()",
      [med.id],
    );
    return true;
  });
}

// All work finishes before returning. A persistent lease also works with
// transaction pooling, unlike session advisory locks across separate queries.
export async function runReminderBatch(
  budgetMs = 35000,
  sender?: Parameters<typeof dispatchOne>[1],
) {
  const owner = randomUUID();
  const acquired = await pool.query(
    "INSERT INTO scheduler_runs VALUES('reminders',$1,now()+interval '2 minutes') ON CONFLICT(id) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until WHERE scheduler_runs.lease_until<now() RETURNING id",
    [owner],
  );
  if (!acquired.rowCount) return { busy: true, dispatched: 0, refreshed: 0 };
  const deadline = Date.now() + budgetMs;
  let dispatched = 0,
    refreshed = 0;
  try {
    await enqueueJobs();
    while (
      dispatched < 100 &&
      Date.now() < deadline &&
      (await dispatchOne(new Date(), sender))
    )
      dispatched++;
    // Reserve most of the function budget for reminders already due.
    while (
      refreshed < 20 &&
      Date.now() < deadline - 10000 &&
      (await refreshOne())
    )
      refreshed++;
    await pool.query(
      "DELETE FROM api_rate_limits WHERE reset_at<now()-interval '1 hour'",
    );
    await heartbeat();
    return { busy: false, dispatched, refreshed };
  } finally {
    await pool.query(
      "DELETE FROM scheduler_runs WHERE id='reminders' AND lease_owner=$1",
      [owner],
    );
  }
}
