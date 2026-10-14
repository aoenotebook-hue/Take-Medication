import { randomUUID, createHash } from "node:crypto";
import { pool, transaction } from "../../../db/client.js";
import { regenerate } from "../../api/src/service.js";
import {
  genericPush,
  projectDose,
  reminderPush,
} from "../../../packages/domain/src/index.js";
import { unseal } from "../../api/src/secrets.js";
import { sendPush } from "./push.js";
export async function refreshHorizon() {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(846102)");
    const meds = (
      await c.query(
        "SELECT m.id,m.patient_id FROM medications m JOIN patients p ON p.id=m.patient_id WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL",
      )
    ).rows;
    for (const m of meds) {
      await c.query("SAVEPOINT medication_horizon");
      try {
        await regenerate(c, m.patient_id, m.id);
        await c.query("DELETE FROM schedule_issues WHERE medication_id=$1", [
          m.id,
        ]);
      } catch (e: any) {
        await c.query("ROLLBACK TO SAVEPOINT medication_horizon");
        if (!e.message?.includes("DST gap")) throw e;
        await c.query(
          "INSERT INTO schedule_issues(medication_id,patient_id,reason) VALUES($1,$2,'DST_GAP_REVIEW') ON CONFLICT(medication_id) DO UPDATE SET recorded_at=now()",
          [m.id, m.patient_id],
        );
      }
      await c.query("RELEASE SAVEPOINT medication_horizon");
    }
    await c.query(
      "INSERT INTO worker_health VALUES('scheduler',now(),now()+interval '30 days') ON CONFLICT(id) DO UPDATE SET heartbeat=now(),horizon_at=excluded.horizon_at",
    );
  });
}
export async function enqueueJobs() {
  return transaction(async (c) => {
    const groups = (
      await c.query(
        "SELECT o.patient_id,o.intended_at,array_agg(o.id::text ORDER BY o.id) ids,s.id subscription_id FROM dose_occurrences o JOIN reminder_preferences p ON p.patient_id=o.patient_id AND p.enabled JOIN devices d ON d.id=p.device_id AND d.revoked_at IS NULL JOIN memberships m ON m.patient_id=o.patient_id AND m.user_id=d.user_id AND m.revoked_at IS NULL JOIN push_subscriptions s ON s.device_id=d.id AND s.disabled_at IS NULL WHERE o.valid AND o.intended_at >= now()-interval '15 minutes' AND o.intended_at < now()+interval '2 minutes' GROUP BY o.patient_id,o.intended_at,s.id",
      )
    ).rows;
    for (const g of groups) {
      const revision = createHash("sha256")
        .update(g.ids.join("|"))
        .digest("hex");
      await c.query(
        "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          g.patient_id,
          g.subscription_id,
          g.intended_at.toISOString(),
          revision,
          JSON.stringify(g.ids),
          g.intended_at,
          new Date(
            g.intended_at.getTime() +
              Number(process.env.REMINDER_FRESHNESS_SECONDS || 900) * 1000,
          ),
        ],
      );
    }
  });
}
export async function dispatchOne(
  now = new Date(),
  sender: (
    subscription: any,
    payload: any,
    ttl: number,
  ) => Promise<{ statusCode: number; simulated?: boolean }> = sendPush,
) {
  const leaseOwner = randomUUID();
  const job = await transaction(async (c) => {
    await c.query(
      "UPDATE reminder_jobs SET state='expired',lease_until=NULL WHERE expires_at<=$1 AND state IN ('queued','leased')",
      [now],
    );
    return (
      await c.query(
        "WITH claim AS (SELECT id FROM reminder_jobs WHERE (state='queued' OR (state='leased' AND lease_until<$1)) AND due_at<=$1 AND expires_at>$1 AND (retry_at IS NULL OR retry_at<=$1) ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE reminder_jobs j SET state='leased',lease_until=$1::timestamptz+interval '60 seconds',lease_owner=$2,attempts=attempts+1 FROM claim WHERE j.id=claim.id RETURNING j.*",
        [now, leaseOwner],
      )
    ).rows[0];
  });
  if (!job) return false;
  // Hold the occurrence and device rows through send: competing edits/revocations wait for this short send.
  await transaction(async (c) => {
    const locked = (
      await c.query(
        "SELECT * FROM reminder_jobs WHERE id=$1 AND lease_owner=$2 AND state='leased' FOR UPDATE",
        [job.id, leaseOwner],
      )
    ).rows[0];
    if (!locked) return;
    const sub = (
      await c.query(
        "SELECT s.*,d.user_id,d.revoked_at,p.enabled,pt.data profile FROM push_subscriptions s JOIN devices d ON d.id=s.device_id JOIN patients pt ON pt.id=$2 JOIN reminder_preferences p ON p.device_id=d.id AND p.patient_id=$2 JOIN memberships m ON m.patient_id=$2 AND m.user_id=d.user_id AND m.revoked_at IS NULL WHERE s.id=$1 AND pt.deleted_at IS NULL FOR UPDATE OF s,d,p,m",
        [job.subscription_id, job.patient_id],
      )
    ).rows[0];
    let valid = Boolean(
      sub && !sub.disabled_at && !sub.revoked_at && sub.enabled,
    );
    let due: any[] = [];
    if (job.kind !== "test") {
      const occurrences = (
        await c.query(
          "SELECT * FROM dose_occurrences WHERE id=ANY($1::uuid[]) FOR UPDATE",
          [job.occurrence_ids],
        )
      ).rows;
      valid =
        valid &&
        occurrences.length === job.occurrence_ids.length &&
        occurrences.every((o) => o.valid);
      const events = (
        await c.query(
          "SELECT * FROM dose_events WHERE occurrence_id=ANY($1::uuid[])",
          [job.occurrence_ids],
        )
      ).rows;
      due = occurrences.filter(
        (o) =>
          projectDose(events.filter((e) => e.occurrence_id === o.id)).status ===
          "unconfirmed",
      );
      valid = valid && due.length > 0;
    }
    const remaining = Math.floor(
      (job.expires_at.getTime() - Date.now()) / 1000,
    );
    if (!valid || remaining <= 0) {
      await c.query(
        "UPDATE reminder_jobs SET state=$2,lease_until=NULL WHERE id=$1",
        [job.id, remaining <= 0 ? "expired" : "cancelled"],
      );
      return;
    }
    const tag = createHash("sha256")
      .update(job.patient_id + "|" + job.group_key + "|" + job.kind)
      .digest("hex")
      .slice(0, 32);
    try {
      let payload: any = genericPush(
        job.id,
        tag,
        job.expires_at.toISOString(),
        sub.profile.language,
      );
      if (due.length) {
        // Name only the medicines still due; the push is end-to-end encrypted.
        const meds = (
          await c.query(
            "SELECT id,data FROM medications WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL",
            [due.map((o) => o.medication_id)],
          )
        ).rows;
        const items = due
          .map((o) => {
            const m = meds.find((x) => x.id === o.medication_id);
            return m
              ? {
                  name: m.data.name,
                  strength: m.data.strength,
                  amount: o.data?.amount,
                  unit: o.data?.unit,
                }
              : undefined;
          })
          .filter(Boolean) as any[];
        items.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
        if (items.length)
          payload = reminderPush(
            job.id,
            tag,
            job.expires_at.toISOString(),
            sub.profile.language,
            due[0].local_time,
            items,
            String(job.kind).startsWith("snooze"),
          );
      }
      const r = await sender(unseal(sub.data), payload, remaining);
      await c.query(
        "INSERT INTO push_attempts(job_id,state,status_code) VALUES($1,$2,$3)",
        [job.id, (r as any).simulated ? "simulated" : "accepted", r.statusCode],
      );
      await c.query(
        "UPDATE reminder_jobs SET state=$2,lease_until=NULL WHERE id=$1",
        [job.id, (r as any).simulated ? "simulated" : "accepted"],
      );
    } catch (e: any) {
      const code = Number(e.statusCode) || 0;
      if ([404, 410].includes(code))
        await c.query(
          "UPDATE push_subscriptions SET disabled_at=now() WHERE id=$1",
          [sub.id],
        );
      const transient = code === 0 || code === 429 || code >= 500;
      const header = e.headers?.["retry-after"];
      const retryAfter = header
        ? Number(header) * 1000 || Date.parse(header) - Date.now()
        : 0;
      const wait = Math.max(
        retryAfter,
        Math.min(60000, 1000 * 2 ** Math.min(job.attempts, 6)) +
          Math.random() * 1000,
      );
      const retry = new Date(Date.now() + wait);
      const state = transient && retry < job.expires_at ? "queued" : "failed";
      await c.query(
        "INSERT INTO push_attempts(job_id,state,status_code) VALUES($1,$2,$3)",
        [
          job.id,
          transient ? "transient-error" : "configuration-or-subscription-error",
          code,
        ],
      );
      await c.query(
        "UPDATE reminder_jobs SET state=$2,retry_at=$3,lease_until=NULL WHERE id=$1",
        [job.id, state, retry],
      );
      if ([401, 403].includes(code))
        console.error(
          "Push configuration/authorization error; check worker credentials",
        );
    }
  });
  return true;
}
export async function heartbeat() {
  await pool.query(
    "INSERT INTO worker_health(id,heartbeat) VALUES('worker',now()) ON CONFLICT(id) DO UPDATE SET heartbeat=now()",
  );
}
