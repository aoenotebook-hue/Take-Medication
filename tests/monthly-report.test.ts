import { describe, it, expect } from "vitest";
import {
  buildMonthlyReport,
  monthRange,
} from "../packages/domain/src/monthly-report";
const med = [{ id: "m", data: { name: "Synthetic medicine" } }];
const dose = (id: string, at = "2026-10-05T00:00:00Z", valid = true) => ({
  id,
  medication_id: "m",
  intended_at: at,
  valid,
});
const event = (
  id: string,
  o: string | null,
  action: string,
  base: string[] = [],
) => ({
  id,
  occurrence_id: o,
  medication_id: "m",
  action,
  base_event_ids: base,
  actual_at: "2026-10-05T00:00:00Z",
  client_at: "2026-10-05T00:00:00Z",
});
const now = new Date("2026-10-20T12:00:00Z");
describe("monthly dose report", () => {
  it("separates taken, skipped and missing records with an honest denominator", () => {
    const r = buildMonthlyReport(
      "2026-10",
      "Asia/Bangkok",
      med,
      [
        dose("a"),
        dose("b"),
        dose("c"),
        dose("future", "2026-10-30T00:00:00Z"),
        dose("replaced", undefined, false),
      ],
      [event("e1", "a", "taken"), event("e2", "b", "skipped")],
      now,
    );
    expect(r.totals).toMatchObject({
      scheduled: 3,
      taken: 1,
      skipped: 1,
      unconfirmed: 1,
      conflict: 0,
      notRecorded: 2,
      takenPercent: 33.3,
      notRecordedPercent: 66.7,
    });
  });
  it("projects corrections/undo and keeps unresolved conflicts separate", () => {
    const r = buildMonthlyReport(
      "2026-10",
      "UTC",
      med,
      [dose("a"), dose("b")],
      [
        event("taken", "a", "taken"),
        event("undo", "a", "undo", ["taken"]),
        event("x", "b", "taken"),
        event("y", "b", "skipped"),
      ],
      now,
    );
    expect(r.totals).toMatchObject({
      scheduled: 2,
      taken: 0,
      unconfirmed: 1,
      conflict: 1,
      notRecorded: 1,
      notRecordedPercent: 50,
    });
  });
  it("excludes PRN from scheduled-dose percentages", () => {
    const r = buildMonthlyReport(
      "2026-10",
      "UTC",
      med,
      [],
      [event("prn", null, "as-needed")],
      now,
    );
    expect(r.totals.takenPercent).toBeNull();
    expect(r.totals.notRecordedPercent).toBeNull();
    expect(r.asNeeded).toEqual([{ name: "Synthetic medicine", count: 1 }]);
  });
  it("uses the patient timezone at month boundaries and handles leap years", () => {
    expect(monthRange("2028-02", "Asia/Bangkok")).toEqual({
      from: "2028-01-31T17:00:00.000Z",
      to: "2028-02-29T17:00:00.000Z",
    });
    const r = buildMonthlyReport(
      "2026-10",
      "Asia/Bangkok",
      med,
      [dose("a", "2026-09-30T18:00:00Z"), dose("b", "2026-09-30T16:00:00Z")],
      [],
      now,
    );
    expect(r.totals.scheduled).toBe(1);
  });
  it("bounds DST months without assuming every day is 24 hours", () => {
    expect(monthRange("2026-03", "America/New_York")).toEqual({
      from: "2026-03-01T05:00:00.000Z",
      to: "2026-04-01T04:00:00.000Z",
    });
    expect(() => monthRange("2026-13", "UTC")).toThrow();
    expect(() => monthRange("2026-10", "bad/zone")).toThrow();
  });
});
