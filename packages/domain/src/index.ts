import { z } from "zod";
import { v5 as uuidV5 } from "uuid";
import { DateTime } from "luxon";
// Quantities remain original decimal/rational strings. Never derive a dose from strength.
export const quantity = z
  .string()
  .regex(/^(?:\d+(?:\.\d+)?|\d+\/\d+)$/)
  .refine((s) => {
    const [a, b = "1"] = s.split("/");
    return Number(a) > 0 && Number(b) > 0;
  }, "Positive quantity required");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s).isValid);
export const slotSchema = z.object({
  id: z.string().min(1),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  amount: quantity,
  unit: z
    .string()
    .max(50)
    .refine((v) => v.trim().length > 0, "Required"),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
});
export const regimenSchema = z
  .object({
    status: z.enum([
      "active",
      "paused",
      "stopped",
      "draft",
      "reference",
      "as-needed",
    ]),
    instructions: z.string().max(4000),
    food: z.string().max(1000),
    route: z.string().max(100),
    timezone: z
      .string()
      .refine(
        (s) => DateTime.now().setZone(s).isValid,
        "Invalid IANA timezone",
      ),
    start: date,
    end: date.optional(),
    slots: z.array(slotSchema).max(12),
    confirmed: z.boolean(),
    source: z.string().max(1000),
    reason: z.string().max(1000),
    effectiveAt: z.string().datetime({ offset: true }),
    effectiveMode: z.enum(["at-time", "on-commit"]).optional(),
    prnIndication: z.string().optional(),
    prnInterval: z.string().optional(),
    prnMaximum: z.string().optional(),
    // Dose per as-needed use, as written on the label (no scheduled slots).
    prnAmount: z.string().max(50).optional(),
    prnUnit: z.string().max(50).optional(),
  })
  .superRefine((r, c) => {
    if (r.end && r.end < r.start)
      c.addIssue({
        code: "custom",
        message: "End precedes start",
        path: ["end"],
      });
    if (
      r.status === "active" &&
      (!r.confirmed ||
        !r.instructions.trim() ||
        !r.route.trim() ||
        ["unknown", "unclear", "?", "ไม่ทราบ", "ไม่ชัดเจน"].includes(
          r.route.trim().toLowerCase(),
        ) ||
        r.slots.some((s) =>
          ["unknown", "unclear", "?", "ไม่ทราบ", "ไม่ชัดเจน"].includes(
            s.unit.trim().toLowerCase(),
          ),
        ) ||
        !r.slots.length)
    )
      c.addIssue({
        code: "custom",
        message: "Confirm complete instructions before reminders",
        path: ["confirmed"],
      });
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const s of r.slots) {
      if (ids.has(s.id))
        c.addIssue({ code: "custom", message: "Duplicate slot id" });
      ids.add(s.id);
      for (const d of s.weekdays) {
        const k = d + ":" + s.time;
        if (seen.has(k))
          c.addIssue({ code: "custom", message: "Duplicate schedule slot" });
        seen.add(k);
      }
    }
  });
export const medicationSchema = z.object({
  name: z
    .string()
    .max(200)
    .refine((v) => v.trim().length > 0, "Required"),
  generic: z.string().max(200),
  brand: z.string().max(200),
  strength: z.string().max(500),
  form: z.enum([
    "tablet",
    "capsule",
    "liquid",
    "drops",
    "injection",
    "inhaler",
    "topical",
    "other",
  ]),
  route: z.string().max(100),
  purpose: z.string().max(500),
  productType: z.enum(["prescription", "nonprescription", "supplement"]),
  source: z.string().max(1000),
  verified: z.boolean().default(false),
});
export const profileSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    dob: date.optional(),
    language: z.enum(["th", "en"]),
    timezone: z.string().refine((s) => DateTime.now().setZone(s).isValid),
    allergyStatus: z.enum(["unknown", "none-known", "known"]),
    allergies: z
      .array(
        z.object({
          substance: z.string().min(1),
          reaction: z.string(),
          source: z.string(),
        }),
      )
      .max(30),
    reviewedAt: z.string().optional(),
    automaticDrugInformation: z.boolean().default(true),
  })
  .superRefine((p, c) => {
    if (p.allergyStatus === "known" && !p.allergies.length)
      c.addIssue({
        code: "custom",
        path: ["allergies"],
        message: "Record at least one known allergy",
      });
    if (p.allergyStatus !== "known" && p.allergies.length)
      c.addIssue({
        code: "custom",
        path: ["allergies"],
        message: "Allergy status must match recorded allergies",
      });
  });
export type Regimen = z.infer<typeof regimenSchema>;
export type Medication = z.infer<typeof medicationSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Occurrence = {
  id: string;
  regimen_id: string;
  medication_id: string;
  patient_id: string;
  slot_id: string;
  local_date: string;
  local_time: string;
  timezone: string;
  intended_at: string;
  data: { amount: string; unit: string };
  valid: boolean;
};
// Deterministic UUID from the complete immutable regimen/slot/date identity.
export function occurrenceId(key: string) {
  return uuidV5(key, "7b791b10-a6ab-4aaf-9abe-5cd5ca22131e");
}
export function resolveWall(date: string, time: string, zone: string) {
  const wall = date + "T" + time;
  const dt = DateTime.fromISO(wall, { zone });
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== wall)
    throw new Error("DST gap: review this clock time");
  return dt.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis())[0];
} // overlaps: earliest UTC, once
export function generateOccurrences(
  patientId: string,
  medicationId: string,
  regimenId: string,
  r: Regimen,
  from: string,
  to: string,
  nextEffective?: string,
): Occurrence[] {
  if (r.status !== "active") return [];
  const out: Occurrence[] = [];
  let d = DateTime.fromISO(from, { zone: r.timezone }).startOf("day");
  const last = DateTime.fromISO(to, { zone: r.timezone }).startOf("day");
  if (last.diff(d, "days").days > 62)
    throw new Error("Range must be at most 62 days");
  for (; d <= last; d = d.plus({ days: 1 })) {
    const day = d.toISODate()!;
    if (day < r.start || (r.end && day > r.end)) continue;
    for (const s of r.slots) {
      if (!s.weekdays.includes(d.weekday)) continue;
      const utc = resolveWall(day, s.time, r.timezone).toUTC().toISO()!;
      if (
        utc < DateTime.fromISO(r.effectiveAt).toUTC().toISO()! ||
        (nextEffective &&
          DateTime.fromISO(utc) >= DateTime.fromISO(nextEffective))
      )
        continue;
      out.push({
        id: occurrenceId(`${regimenId}|${s.id}|${day}`),
        regimen_id: regimenId,
        medication_id: medicationId,
        patient_id: patientId,
        slot_id: s.id,
        local_date: day,
        local_time: s.time,
        timezone: r.timezone,
        intended_at: utc,
        data: { amount: s.amount, unit: s.unit },
        valid: true,
      });
    }
  }
  return out;
}
export type DoseEvent = {
  id: string;
  occurrence_id: string | null;
  action: string;
  base_event_ids: string[];
  actual_at?: string;
  data?: { status?: string };
};
export function projectDose(events: DoseEvent[]) {
  const removed = new Set(events.flatMap((e) => e.base_event_ids));
  const heads = events.filter((e) => !removed.has(e.id));
  if (heads.length > 1)
    return { status: "conflict", heads: heads.map((e) => e.id) };
  const e = heads[0];
  return {
    status:
      !e || e.action === "undo"
        ? "unconfirmed"
        : e.action === "resolve"
          ? e.data?.status || "unconfirmed"
          : e.action,
    heads: heads.map((e) => e.id),
  };
}
export type DayPeriod = "morning" | "noon" | "evening" | "bedtime";
/** Part of the day a clock time falls in; shared by screens and notifications. */
export function periodOf(time: string): DayPeriod {
  const h = Number(time.slice(0, 2));
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 16) return "noon";
  if (h >= 16 && h < 20) return "evening";
  return "bedtime";
}
export const periodNames: Record<"th" | "en", Record<DayPeriod, string>> = {
  th: { morning: "เช้า", noon: "กลางวัน", evening: "เย็น", bedtime: "ก่อนนอน" },
  en: {
    morning: "Morning",
    noon: "Noon",
    evening: "Evening",
    bedtime: "Bedtime",
  },
};
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
/**
 * Reminder that names the medicines due and the time. The phone can still hide
 * the names (Settings), and falls back to a neutral text when it is stale.
 */
export function reminderPush(
  jobId: string,
  tag: string,
  expiry: string,
  language: string,
  time: string,
  items: {
    name: string;
    strength?: string;
    amount?: string;
    unit?: string;
    use?: string;
    useKind?: "general" | "recorded";
  }[],
  repeat = false,
) {
  const th = language !== "en";
  const names = periodNames[th ? "th" : "en"];
  const shown = items.slice(0, 8);
  const lines = shown.map(
    (i) =>
      "• " +
      [clip(i.name, 80), clip(i.strength, 40)].filter(Boolean).join(" ") +
      (i.amount ? " — " + clip(i.amount, 12) + " " + clip(i.unit, 20) : "") +
      (i.use
        ? "\n  " +
          (i.useKind === "recorded"
            ? th
              ? "เหตุผลที่บันทึก: "
              : "Recorded reason: "
            : th
              ? "ใช้ทั่วไป: "
              : "Common use: ") +
          clip(i.use, 80)
        : ""),
  );
  if (items.length > shown.length)
    lines.push(
      th
        ? `และอีก ${items.length - shown.length} รายการ`
        : `and ${items.length - shown.length} more`,
    );
  return {
    ...genericPush(jobId, tag, expiry, language),
    snooze: repeat,
    detail: {
      title:
        (th ? "ถึงเวลาใช้ยา" : "Medicine time") +
        (repeat ? (th ? " (เตือนอีกครั้ง)" : " (reminder)") : "") +
        " · " +
        names[periodOf(time)] +
        " " +
        clip(time, 5),
      body: lines.join("\n").slice(0, 650),
    },
  };
}
export function genericPush(
  jobId: string,
  tag: string,
  expiry: string,
  language = "th",
) {
  return {
    schema: 1,
    id: jobId,
    tag,
    expiresAt: expiry,
    title: language === "th" ? "แจ้งเตือนยา" : "Medication reminder",
    body:
      language === "th"
        ? "เปิดแอปเพื่อตรวจสอบรายการยา"
        : "Open to review your medicine schedule.",
  };
}
