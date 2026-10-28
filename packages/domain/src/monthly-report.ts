import { DateTime } from "luxon";
import { projectDose, type DoseEvent } from "./index.js";
export type ReportCounts = {
  scheduled: number;
  taken: number;
  skipped: number;
  unconfirmed: number;
  conflict: number;
};
export type ReportRow = ReportCounts & {
  id: string;
  name: string;
  takenPercent: number | null;
  notRecorded: number;
  notRecordedPercent: number | null;
};
export type MonthlyReport = {
  month: string;
  timezone: string;
  generatedAt: string;
  through: string;
  rows: ReportRow[];
  totals: ReportRow;
  asNeeded: { name: string; count: number }[];
};
export function monthRange(month: string, zone: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Invalid report month");
  const start = DateTime.fromISO(month + "-01", { zone }).startOf("month");
  if (!start.isValid) throw new Error("Invalid report timezone");
  return {
    from: start.toUTC().toISO()!,
    to: start.plus({ months: 1 }).toUTC().toISO()!,
  };
}
const counts = (): ReportCounts => ({
  scheduled: 0,
  taken: 0,
  skipped: 0,
  unconfirmed: 0,
  conflict: 0,
});
const row = (id: string, name: string, c: ReportCounts): ReportRow => ({
  ...c,
  id,
  name,
  takenPercent: c.scheduled
    ? Math.round((c.taken / c.scheduled) * 1000) / 10
    : null,
  notRecorded: c.skipped + c.unconfirmed,
  notRecordedPercent: c.scheduled
    ? Math.round(((c.skipped + c.unconfirmed) / c.scheduled) * 1000) / 10
    : null,
});
export function buildMonthlyReport(
  month: string,
  timezone: string,
  medications: { id: string; data: { name: string } }[],
  occurrences: {
    id: string;
    medication_id: string;
    intended_at: string | Date;
    valid: boolean;
  }[],
  events: (DoseEvent & {
    medication_id?: string;
    client_at?: string;
    received_at?: string;
  })[],
  now = new Date(),
): MonthlyReport {
  const { from, to } = monthRange(month, timezone),
    start = Date.parse(from),
    end = Date.parse(to),
    until = now.getTime();
  const groups = new Map<string, DoseEvent[]>();
  for (const e of events)
    if (e.occurrence_id) {
      const group = groups.get(e.occurrence_id) || [];
      group.push(e);
      groups.set(e.occurrence_id, group);
    }
  const byMed = new Map<string, ReportCounts>();
  for (const o of occurrences) {
    const at = new Date(o.intended_at).getTime();
    if (!o.valid || at < start || at >= end || at > until) continue;
    const c = byMed.get(o.medication_id) || counts();
    const status = projectDose(groups.get(o.id) || []).status;
    c.scheduled++;
    if (status === "taken" || status === "skipped" || status === "conflict")
      c[status]++;
    else c.unconfirmed++;
    byMed.set(o.medication_id, c);
  }
  const rows = [...byMed]
    .map(([id, c]) =>
      row(id, medications.find((m) => m.id === id)?.data.name || "—", c),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = counts();
  for (const r of rows)
    for (const key of Object.keys(total) as (keyof ReportCounts)[])
      total[key] += r[key];
  const prn = new Map<string, number>();
  for (const e of events) {
    const at = Date.parse(e.actual_at || e.client_at || "");
    if (
      e.action === "as-needed" &&
      !e.occurrence_id &&
      at >= start &&
      at < end &&
      at <= until &&
      e.medication_id
    )
      prn.set(e.medication_id, (prn.get(e.medication_id) || 0) + 1);
  }
  return {
    month,
    timezone,
    generatedAt: now.toISOString(),
    through: new Date(Math.min(until, end)).toISOString(),
    rows,
    totals: row("total", "Total", total),
    asNeeded: [...prn].map(([id, count]) => ({
      name: medications.find((m) => m.id === id)?.data.name || "—",
      count,
    })),
  };
}
