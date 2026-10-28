import { transaction } from "../../../db/client.js";
import { authorize, HttpError } from "./service.js";
import {
  buildMonthlyReport,
  monthRange,
} from "../../../packages/domain/src/monthly-report.js";
export async function monthlyReport(
  actor: string,
  patient: string,
  month: string,
) {
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await authorize(c, actor, patient);
    const p = (
      await c.query("SELECT data FROM patients WHERE id=$1", [patient])
    ).rows[0];
    const zone = p.data.timezone || "Asia/Bangkok";
    let range;
    try {
      range = monthRange(month, zone);
    } catch {
      throw new HttpError(422, "Invalid report month or timezone");
    }
    const now = new Date();
    const occurrences = (
      await c.query(
        "SELECT id,medication_id,intended_at,valid FROM dose_occurrences WHERE patient_id=$1 AND intended_at >= $2 AND intended_at < $3 AND intended_at<= $4 AND valid ORDER BY intended_at LIMIT 20001",
        [patient, range.from, range.to, now],
      )
    ).rows;
    if (occurrences.length > 20000)
      throw new HttpError(422, "Report is too large; contact support");
    const events = (
      await c.query(
        "SELECT e.* FROM dose_events e LEFT JOIN dose_occurrences o ON o.id=e.occurrence_id WHERE e.patient_id=$1 AND ((o.valid AND o.intended_at >= $2 AND o.intended_at < $3 AND o.intended_at <= $4) OR (e.occurrence_id IS NULL AND coalesce(e.actual_at,e.client_at) >= $2::timestamptz AND coalesce(e.actual_at,e.client_at) < $3::timestamptz)) ORDER BY e.received_at LIMIT 100001",
        [patient, range.from, range.to, now],
      )
    ).rows;
    if (events.length > 100000)
      throw new HttpError(422, "Report is too large; contact support");
    // Keep past records for medicines subsequently removed from the active list.
    const medications = (
      await c.query("SELECT id,data FROM medications WHERE patient_id=$1", [
        patient,
      ])
    ).rows;
    return buildMonthlyReport(
      month,
      zone,
      medications,
      occurrences,
      events,
      now,
    );
  });
}
