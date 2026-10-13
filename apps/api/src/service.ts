import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DateTime } from "luxon";
import { z } from "zod";
import { pool, transaction } from "../../../db/client";
import {
  medicationSchema,
  regimenSchema,
  profileSchema,
  generateOccurrences,
  projectDose,
  type Regimen,
} from "../../../packages/domain/src";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public current?: unknown,
  ) {
    super(message);
  }
}
export async function authorize(
  c: Pick<PoolClient, "query">,
  actor: string,
  patient: string,
  level = "viewer",
) {
  const r = await c.query(
    "SELECT m.role FROM memberships m JOIN patients p ON p.id=m.patient_id WHERE m.user_id=$1 AND m.patient_id=$2 AND m.revoked_at IS NULL AND p.deleted_at IS NULL",
    [actor, patient],
  );
  const role = r.rows[0]?.role;
  if (
    !role ||
    (["editor", "owner"].includes(level) && role === "viewer") ||
    (level === "owner" && role !== "owner")
  )
    throw new HttpError(403, "Access denied");
  return role;
}
export async function audit(
  c: PoolClient,
  actor: string,
  patient: string,
  action: string,
  target: string,
  tombstone = false,
) {
  await c.query(
    "INSERT INTO audit_events(patient_id,actor_id,action,target_id) VALUES($1,$2,$3,$4)",
    [patient, actor, action, target],
  );
  await c.query(
    "INSERT INTO change_feed(patient_id,resource_id,kind,tombstone) VALUES($1,$2,$3,$4)",
    [patient, target, action, tombstone],
  );
}
export async function regenerate(c: PoolClient, patient: string, med: string) {
  const versions = (
    await c.query(
      "SELECT * FROM regimen_versions WHERE medication_id=$1 AND id NOT IN (SELECT regimen_id FROM regimen_supersessions) ORDER BY effective_at",
      [med],
    )
  ).rows;
  const now = DateTime.utc();
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i],
      next = versions[i + 1]?.effective_at.toISOString();
    if (next && DateTime.fromISO(next) <= now) continue;
    const from = now.setZone(v.data.timezone).minus({ days: 1 }).toISODate()!;
    const to = now.setZone(v.data.timezone).plus({ days: 30 }).toISODate()!;
    for (const o of generateOccurrences(
      patient,
      med,
      v.id,
      v.data,
      from,
      to,
      next,
    )) {
      await c.query(
        "INSERT INTO dose_occurrences(id,patient_id,medication_id,regimen_id,slot_id,local_date,local_time,timezone,intended_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",
        [
          o.id,
          patient,
          med,
          v.id,
          o.slot_id,
          o.local_date,
          o.local_time,
          o.timezone,
          o.intended_at,
          o.data,
        ],
      );
    }
  }
}
export const operationSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  patientId: z.string().uuid(),
  resourceId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  kind: z.enum(["profile", "medication", "regimen", "dose", "snooze"]),
  clientAt: z.string().datetime({ offset: true }),
  data: z.any(),
});
export type Operation = z.infer<typeof operationSchema>;
export async function applyOperation(actor: string, input: unknown) {
  const op = operationSchema.parse(input);
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      actor + op.id,
    ]);
    await authorize(
      c,
      actor,
      op.patientId,
      op.kind === "profile" ? "owner" : "editor",
    );
    const prior = await c.query(
      "SELECT result FROM sync_operations WHERE actor_id=$1 AND id=$2",
      [actor, op.id],
    );
    if (prior.rowCount) return prior.rows[0].result;
    let result: any = { id: op.id, status: "acknowledged" };
    if (op.kind === "profile") {
      const data = profileSchema.parse(op.data);
      const row = (
        await c.query("SELECT * FROM patients WHERE id=$1 FOR UPDATE", [
          op.patientId,
        ])
      ).rows[0];
      if (row.version !== op.baseVersion)
        throw new HttpError(409, "Profile changed", row);
      await c.query(
        "UPDATE patients SET data=$2,version=version+1 WHERE id=$1",
        [op.patientId, data],
      );
      result.version = row.version + 1;
    }
    if (op.kind === "medication") {
      const data = medicationSchema.parse(op.data);
      const row = (
        await c.query("SELECT * FROM medications WHERE id=$1 FOR UPDATE", [
          op.resourceId,
        ])
      ).rows[0];
      if (row) {
        if (row.patient_id !== op.patientId)
          throw new HttpError(403, "Access denied");
        if (row.version !== op.baseVersion)
          throw new HttpError(409, "Medication changed", row);
        const identityChanged = ["name", "strength", "form"].some(
          (k) => row.data[k] !== data[k as keyof typeof data],
        );
        if (identityChanged && !op.data.spellingCorrection)
          throw new HttpError(
            422,
            "Create a new medicine for an identity change, or confirm spelling correction",
          );
        await c.query(
          "UPDATE medications SET data=$2,version=version+1 WHERE id=$1",
          [op.resourceId, data],
        );
        result.version = row.version + 1;
      } else {
        if (op.baseVersion !== 0)
          throw new HttpError(409, "Medicine no longer exists");
        await c.query(
          "INSERT INTO medications(id,patient_id,data) VALUES($1,$2,$3)",
          [op.resourceId, op.patientId, data],
        );
        result.version = 1;
      }
    }
    if (op.kind === "regimen") {
      const data = regimenSchema.parse(op.data);
      if (data.effectiveMode === "on-commit")
        data.effectiveAt = new Date().toISOString();
      const med = (
        await c.query(
          "SELECT * FROM medications WHERE id=$1 AND patient_id=$2 FOR UPDATE",
          [op.resourceId, op.patientId],
        )
      ).rows[0];
      if (!med) throw new HttpError(404, "Medicine not found");
      if (med.version !== op.baseVersion)
        throw new HttpError(409, "Regimen changed", med);
      const latest = (
        await c.query(
          "SELECT * FROM regimen_versions WHERE medication_id=$1 AND id NOT IN (SELECT regimen_id FROM regimen_supersessions) ORDER BY effective_at DESC LIMIT 1",
          [op.resourceId],
        )
      ).rows[0];
      if (
        latest &&
        DateTime.fromISO(data.effectiveAt) <
          DateTime.utc().minus({ seconds: 5 })
      )
        throw new HttpError(
          409,
          "Effective change overlaps historical instructions",
        );
      if (latest && !data.reason.trim())
        throw new HttpError(422, "Record the reason for this regimen change");
      const regimenId = randomUUID();
      await c.query(
        "INSERT INTO regimen_versions(id,patient_id,medication_id,version,effective_at,data,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          regimenId,
          op.patientId,
          op.resourceId,
          med.version + 1,
          data.effectiveAt,
          data,
          actor,
        ],
      );
      await c.query(
        "INSERT INTO regimen_supersessions(regimen_id,replacement_id,effective_at) SELECT id,$2,$3 FROM regimen_versions WHERE medication_id=$1 AND id<>$2 AND effective_at>=$3 ON CONFLICT DO NOTHING",
        [op.resourceId, regimenId, data.effectiveAt],
      );
      await c.query("UPDATE medications SET version=version+1 WHERE id=$1", [
        op.resourceId,
      ]);
      await c.query(
        "UPDATE dose_occurrences SET valid=false WHERE medication_id=$1 AND intended_at >= $2",
        [op.resourceId, data.effectiveAt],
      );
      await c.query(
        "UPDATE reminder_jobs j SET state='cancelled' WHERE j.patient_id=$1 AND j.state IN ('queued','leased') AND EXISTS(SELECT 1 FROM dose_occurrences o WHERE o.id::text IN (SELECT jsonb_array_elements_text(j.occurrence_ids)) AND NOT o.valid)",
        [op.patientId],
      );
      try {
        await regenerate(c, op.patientId, op.resourceId);
      } catch (e: any) {
        if (e.message?.includes("DST gap"))
          throw new HttpError(
            422,
            "DST gap: review the exact clock time in this timezone",
          );
        throw e;
      }
      await c.query("DELETE FROM schedule_issues WHERE medication_id=$1", [
        op.resourceId,
      ]);
      result.version = med.version + 1;
      result.regimenId = regimenId;
    }
    if (op.kind === "dose") {
      const d = z
        .object({
          occurrenceId: z.string().uuid().nullable(),
          medicationId: z.string().uuid(),
          action: z.enum(["taken", "skipped", "undo", "resolve", "as-needed"]),
          baseEventIds: z.array(z.string().uuid()).max(100),
          actualAt: z.string().datetime({ offset: true }).optional(),
          backdateConfirmed: z.boolean().optional(),
          status: z.enum(["taken", "skipped", "unconfirmed"]).optional(),
        })
        .parse(op.data);
      if (d.actualAt && Date.parse(d.actualAt) > Date.now() + 300000)
        throw new HttpError(
          422,
          "Future administration time cannot be recorded",
        );
      const med = (
        await c.query(
          "SELECT id FROM medications WHERE id=$1 AND patient_id=$2",
          [d.medicationId, op.patientId],
        )
      ).rows[0];
      if (!med) throw new HttpError(403, "Access denied");
      if (d.occurrenceId) {
        const o = (
          await c.query(
            "SELECT * FROM dose_occurrences WHERE id=$1 AND patient_id=$2 AND medication_id=$3 FOR UPDATE",
            [d.occurrenceId, op.patientId, d.medicationId],
          )
        ).rows[0];
        if (!o) throw new HttpError(404, "Occurrence not found");
        if (d.action === "as-needed")
          throw new HttpError(422, "As-needed records have no occurrence");
        if (d.action === "taken" && o.intended_at > new Date())
          throw new HttpError(422, "Future dose cannot be confirmed");
        if (
          d.action === "taken" &&
          new Date().getTime() - o.intended_at.getTime() > 86400000 &&
          !d.backdateConfirmed
        )
          throw new HttpError(422, "Backdated entry needs confirmation");
        const events = (
          await c.query("SELECT * FROM dose_events WHERE occurrence_id=$1", [
            o.id,
          ])
        ).rows;
        const ids = new Set(events.map((e) => e.id));
        if (d.baseEventIds.some((id) => !ids.has(id)))
          throw new HttpError(422, "Correction references another occurrence");
        const p = projectDose(events);
        if (
          d.action === "resolve" &&
          (p.status !== "conflict" ||
            p.heads.some((id) => !d.baseEventIds.includes(id)) ||
            !d.status)
        )
          throw new HttpError(409, "Review all conflicting records");
      } else {
        if (d.action !== "as-needed")
          throw new HttpError(422, "Occurrence required");
        const r = (
          await c.query(
            "SELECT data FROM regimen_versions WHERE medication_id=$1 AND id NOT IN (SELECT regimen_id FROM regimen_supersessions) AND effective_at<=now() ORDER BY effective_at DESC LIMIT 1",
            [d.medicationId],
          )
        ).rows[0];
        if (r?.data.status !== "as-needed")
          throw new HttpError(422, "Not an as-needed medicine");
        if (!d.actualAt)
          throw new HttpError(422, "Administration time required");
      }
      await c.query(
        "INSERT INTO dose_events(id,patient_id,occurrence_id,medication_id,actor_id,action,base_event_ids,actual_at,client_at,data,device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          op.id,
          op.patientId,
          d.occurrenceId,
          d.medicationId,
          actor,
          d.action,
          JSON.stringify(d.baseEventIds),
          d.actualAt || null,
          op.clientAt,
          { status: d.status },
          op.deviceId,
        ],
      );
    }
    if (op.kind === "snooze") {
      const d = z
        .object({
          occurrenceId: z.string().uuid(),
          minutes: z.union([z.literal(10), z.literal(30)]),
        })
        .parse(op.data);
      const o = (
        await c.query(
          "SELECT * FROM dose_occurrences WHERE id=$1 AND patient_id=$2 AND valid FOR UPDATE",
          [d.occurrenceId, op.patientId],
        )
      ).rows[0];
      if (!o) throw new HttpError(409, "Occurrence replaced or stopped");
      const n = (
        await c.query("SELECT count(*) FROM snoozes WHERE occurrence_id=$1", [
          o.id,
        ])
      ).rows[0].count;
      const events = (
        await c.query("SELECT * FROM dose_events WHERE occurrence_id=$1", [
          o.id,
        ])
      ).rows;
      if (Number(n) >= 2 || projectDose(events).status !== "unconfirmed")
        throw new HttpError(409, "Snooze unavailable");
      const expires = new Date(
        o.intended_at.getTime() +
          Number(process.env.REMINDER_FRESHNESS_SECONDS || 900) * 1000,
      );
      const due = new Date(Date.now() + d.minutes * 60000);
      if (due >= expires)
        throw new HttpError(
          422,
          "Snooze exceeds notification freshness window",
        );
      await c.query(
        "INSERT INTO snoozes(id,patient_id,occurrence_id,actor_id) VALUES($1,$2,$3,$4)",
        [op.id, op.patientId, o.id, actor],
      );
      await c.query(
        "INSERT INTO reminder_jobs(id,patient_id,subscription_id,group_key,revision,occurrence_ids,kind,due_at,expires_at) SELECT gen_random_uuid(),$1,s.id,$2,$3,$4,$5,$6,$7 FROM push_subscriptions s JOIN devices d ON d.id=s.device_id JOIN reminder_preferences p ON p.device_id=d.id AND p.patient_id=$1 WHERE p.enabled AND s.disabled_at IS NULL AND d.revoked_at IS NULL",
        [
          op.patientId,
          o.id,
          op.id,
          JSON.stringify([o.id]),
          "snooze-" + op.id,
          due,
          expires,
        ],
      );
    }
    await audit(c, actor, op.patientId, op.kind, op.resourceId);
    await c.query(
      "INSERT INTO sync_operations(actor_id,id,result,device_id,client_at) VALUES($1,$2,$3,$4,$5)",
      [actor, op.id, result, op.deviceId, op.clientAt],
    );
    return result;
  });
}
export async function snapshot(actor: string, patient: string) {
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const role = await authorize(c, actor, patient);
    const profile = (
      await c.query("SELECT * FROM patients WHERE id=$1", [patient])
    ).rows[0];
    const medications = (
      await c.query(
        "SELECT * FROM medications WHERE patient_id=$1 AND deleted_at IS NULL",
        [patient],
      )
    ).rows;
    const regimens = (
      await c.query(
        "SELECT * FROM regimen_versions WHERE patient_id=$1 AND id NOT IN (SELECT regimen_id FROM regimen_supersessions) ORDER BY effective_at",
        [patient],
      )
    ).rows;
    const occurrences = (
      await c.query(
        "SELECT * FROM dose_occurrences WHERE patient_id=$1 AND intended_at BETWEEN now()-interval '30 days' AND now()+interval '30 days' ORDER BY intended_at",
        [patient],
      )
    ).rows;
    const events = (
      await c.query(
        "SELECT * FROM dose_events WHERE patient_id=$1 ORDER BY received_at",
        [patient],
      )
    ).rows;
    const photos = (
      await c.query(
        "SELECT id,medication_id,mime FROM photos WHERE patient_id=$1",
        [patient],
      )
    ).rows;
    const scheduleIssues = (
      await c.query(
        "SELECT medication_id,reason FROM schedule_issues WHERE patient_id=$1",
        [patient],
      )
    ).rows;
    const retiredRegimens = (
      await c.query(
        "SELECT r.*,s.replacement_id FROM regimen_versions r JOIN regimen_supersessions s ON s.regimen_id=r.id WHERE r.patient_id=$1",
        [patient],
      )
    ).rows;
    const auditEvents = (
      await c.query(
        "SELECT * FROM audit_events WHERE patient_id=$1 ORDER BY id DESC LIMIT 200",
        [patient],
      )
    ).rows;
    const cursor = (
      await c.query(
        "SELECT COALESCE(max(cursor),0)::text cursor FROM change_feed",
      )
    ).rows[0].cursor;
    return {
      profile,
      role,
      medications,
      regimens,
      retiredRegimens,
      scheduleIssues,
      occurrences,
      events,
      photos,
      auditEvents,
      cursor,
      serverAt: new Date().toISOString(),
    };
  });
}
