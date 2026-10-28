import { describe, it, expect } from "vitest";
import {
  regimenSchema,
  quantity,
  generateOccurrences,
  resolveWall,
  projectDose,
  genericPush,
  periodOf,
  reminderPush,
} from "../packages/domain/src";
const r = {
  status: "active" as const,
  instructions: "Original label",
  food: "As prescribed",
  route: "oral",
  timezone: "Asia/Bangkok",
  start: "2026-12-31",
  end: "2027-01-02",
  slots: [
    {
      id: "am",
      time: "00:00",
      amount: "0.5",
      unit: "tablet",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
  ],
  confirmed: true,
  source: "synthetic",
  reason: "test",
  effectiveAt: "2026-12-30T00:00:00Z",
};
describe("Schedules and quantities", () => {
  it("preserves decimals/rationals without dose conversions", () => {
    for (const q of ["0.5", "2.5", "1/2", "2"])
      expect(quantity.parse(q)).toBe(q);
    for (const q of ["0", "-1", "1/0", "NaN"])
      expect(quantity.safeParse(q).success).toBe(false);
  });
  it("inclusive end, midnight/year boundary and Bangkok UTC", () => {
    const os = generateOccurrences(
      "p",
      "m",
      "v",
      r,
      "2026-12-31",
      "2027-01-05",
    );
    expect(os).toHaveLength(3);
    expect(os[0].intended_at).toBe("2026-12-30T17:00:00.000Z");
    expect(os[2].local_date).toBe("2027-01-02");
    expect(
      generateOccurrences("p", "m", "v", r, "2026-12-31", "2027-01-05"),
    ).toEqual(os);
  });
  it("selected weekdays and different amounts", () => {
    const x = {
      ...r,
      slots: [
        { ...r.slots[0], weekdays: [4], amount: "2.5", unit: "mL" },
        {
          ...r.slots[0],
          id: "pm",
          time: "20:00",
          weekdays: [4],
          amount: "5",
          unit: "mL",
        },
      ],
    };
    expect(
      generateOccurrences("p", "m", "v", x, "2026-12-31", "2027-01-02").map(
        (o) => o.data.amount,
      ),
    ).toEqual(["2.5", "5"]);
  });
  it("DST gap is flagged and overlap resolves earliest once", () => {
    expect(() =>
      resolveWall("2026-03-08", "02:30", "America/New_York"),
    ).toThrow("DST gap");
    expect(
      resolveWall("2026-11-01", "01:30", "America/New_York").toUTC().toISO(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });
  it("future effective boundary and timezone change preserve previous occurrence IDs", () => {
    const old = generateOccurrences(
      "p",
      "m",
      "v",
      r,
      "2026-12-31",
      "2027-01-02",
      "2027-01-01T00:00:00Z",
    );
    expect(old).toHaveLength(2);
    const updated = {
      ...r,
      timezone: "UTC",
      effectiveAt: "2027-01-01T00:00:00Z",
    };
    expect(
      generateOccurrences(
        "p",
        "m",
        "v2",
        updated,
        "2027-01-01",
        "2027-01-02",
      )[0].intended_at,
    ).toBe("2027-01-01T00:00:00.000Z");
  });
  it("reference, drafts and PRN never generate reminders", () => {
    for (const status of [
      "reference",
      "draft",
      "as-needed",
      "paused",
      "stopped",
    ] as const)
      expect(
        generateOccurrences(
          "p",
          "m",
          "v",
          { ...r, status },
          "2026-12-31",
          "2027-01-02",
        ),
      ).toEqual([]);
  });
  it("blocks invalid slots and incomplete activation", () => {
    expect(regimenSchema.safeParse({ ...r, confirmed: false }).success).toBe(
      false,
    );
    expect(
      regimenSchema.safeParse({ ...r, slots: [r.slots[0], r.slots[0]] })
        .success,
    ).toBe(false);
  });
});
describe("Dose projections", () => {
  it("does not infer missed and exposes independent conflicting entries", () => {
    expect(projectDose([]).status).toBe("unconfirmed");
    const a = {
        id: "a",
        occurrence_id: "o",
        action: "taken",
        base_event_ids: [],
      },
      b = { ...a, id: "b", action: "skipped" };
    expect(projectDose([a, b]).status).toBe("conflict");
    expect(
      projectDose([
        a,
        { id: "u", occurrence_id: "o", action: "undo", base_event_ids: ["a"] },
      ]).status,
    ).toBe("unconfirmed");
    expect(
      projectDose([
        a,
        b,
        {
          id: "r",
          occurrence_id: "o",
          action: "resolve",
          base_event_ids: ["a", "b"],
          data: { status: "taken" },
        },
      ]).status,
    ).toBe("taken");
  });
  it("push contains no medicine instructions", () => {
    const p = genericPush("id", "tag", "2026-01-01");
    expect(Object.keys(p)).toEqual([
      "schema",
      "id",
      "tag",
      "expiresAt",
      "title",
      "body",
    ]);
    expect(p.body).not.toContain("dose");
  });
  it("reminder lists the medicines and the part of the day", () => {
    const p = reminderPush("id", "tag", "2026-01-01", "th", "08:00", [
      { name: "Metformin", strength: "500 mg", amount: "1", unit: "เม็ด" },
      { name: "Amlodipine", amount: "1/2", unit: "เม็ด" },
    ]);
    expect(p.detail.title).toBe("ถึงเวลาใช้ยา · เช้า 08:00");
    expect(p.detail.body).toBe(
      "• Metformin 500 mg — 1 เม็ด\n• Amlodipine — 1/2 เม็ด",
    );
    // The neutral text is still there for a phone that hides names.
    expect(p.body).toBe("เปิดแอปเพื่อตรวจสอบรายการยา");
    const many = reminderPush(
      "id",
      "tag",
      "2026-01-01",
      "en",
      "21:30",
      Array.from({ length: 10 }, (_, i) => ({ name: "Med " + i })),
      true,
    );
    expect(many.detail.title).toBe("Medicine time (reminder) · Bedtime 21:30");
    expect(many.detail.body.split("\n")).toHaveLength(9);
    expect(many.detail.body).toContain("and 2 more");
  });
  it("places short uses under names while preserving neutral privacy text and bounded payloads", () => {
    const p = reminderPush("id", "tag", "2026-10-28T00:00:00Z", "en", "08:00", [
      { name: "Amlodipine", use: "Lowers blood pressure" },
    ]);
    expect(p.detail.body).toBe(
      "• Amlodipine\n  Common use: Lowers blood pressure",
    );
    expect(p.body).not.toContain("pressure");
    const large = reminderPush(
      "id",
      "tag",
      "2026-10-28T00:00:00Z",
      "th",
      "08:00",
      Array.from({ length: 8 }, () => ({
        name: "ยา".repeat(80),
        strength: "500 mg",
        amount: "1",
        unit: "เม็ด",
        use: "ลดความดันโลหิต",
      })),
    );
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeLessThan(
      3500,
    );
  });
  it("every clock time belongs to one part of the day", () => {
    expect(
      [
        "06:00",
        "10:59",
        "11:00",
        "15:59",
        "16:00",
        "19:59",
        "20:00",
        "03:59",
      ].map(periodOf),
    ).toEqual([
      "morning",
      "morning",
      "noon",
      "noon",
      "evening",
      "evening",
      "bedtime",
      "bedtime",
    ]);
  });
});
