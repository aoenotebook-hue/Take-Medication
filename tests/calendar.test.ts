import { it, expect } from "vitest";
import { DateTime } from "luxon";
import { buildCalendar, iosVersion } from "../apps/web/src/calendar";

const now = DateTime.fromISO("2026-10-16T09:00:00", { zone: "Asia/Bangkok" });
const med = (id: string, name: string, strength = "") => ({
  id,
  data: { name, strength },
});
const reg = (medication_id: string, data: any) => ({
  id: "r-" + medication_id,
  medication_id,
  effective_at: "2026-01-01T00:00:00Z",
  data: {
    status: "active",
    start: "2026-01-01",
    timezone: "Asia/Bangkok",
    ...data,
  },
});
const snapshot: any = {
  profile: {
    id: "p1",
    data: { displayName: "Synthetic", timezone: "Asia/Bangkok" },
  },
  medications: [
    med("a", "Metformin", "500 mg"),
    med("b", "Amlodipine"),
    med("c", "Stopped one"),
  ],
  regimens: [
    reg("a", {
      slots: [
        {
          id: "1",
          time: "08:00",
          amount: "1",
          unit: "เม็ด",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
        },
        {
          id: "2",
          time: "18:00",
          amount: "1",
          unit: "เม็ด",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
        },
      ],
    }),
    reg("b", {
      end: "2026-12-31",
      slots: [
        {
          id: "1",
          time: "08:00",
          amount: "1/2",
          unit: "เม็ด",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
        },
      ],
    }),
    reg("c", {
      status: "stopped",
      slots: [
        { id: "1", time: "12:00", amount: "1", unit: "เม็ด", weekdays: [1] },
      ],
    }),
  ],
};

it("calendar file has one repeating event per dose time with three alerts", () => {
  const { text, events } = buildCalendar(snapshot, "th", { now });
  expect(events).toBe(2); // 08:00 (two medicines together) and 18:00; stopped one skipped
  expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(text.match(/BEGIN:VALARM/g)).toHaveLength(6);
  expect(text).toContain("DTSTART:20261016T080000");
  expect(text).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU");
  expect(text).toContain("TRIGGER:PT0S");
  expect(text).toContain("TRIGGER:PT10M");
  expect(text).toContain("TRIGGER:PT20M");
  // Both 08:00 medicines are listed in one event; the stopped one is not.
  const unfolded = text.replace(/\r\n /g, "");
  expect(unfolded).toContain(
    "• Metformin 500 mg — 1 เม็ด\\n  ใช้ทั่วไป: ลดน้ำตาลในเลือด",
  );
  expect(unfolded).not.toContain("Stopped one");
  expect(unfolded).toContain("ถึงเวลาใช้ยา · เช้า 08:00");
  // The later end date wins only when every medicine at that time ends.
  expect(unfolded).not.toContain("UNTIL=20261231T235959;");
  for (const line of text.split("\r\n"))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});

it("medicine names can be kept off the lock screen", () => {
  const { text } = buildCalendar(snapshot, "en", { now, hideNames: true });
  const unfolded = text.replace(/\r\n /g, "");
  expect(unfolded).not.toContain("Metformin");
  expect(unfolded).not.toContain("Lowers blood sugar");
  expect(unfolded).toContain("Open My Medicine to see your medicines");
});

it("future start dates are respected and ends become UNTIL", () => {
  const only = {
    ...snapshot,
    medications: [med("b", "Amlodipine")],
    regimens: [
      reg("b", {
        start: "2026-11-02",
        end: "2026-12-31",
        slots: [
          {
            id: "1",
            time: "21:30",
            amount: "1",
            unit: "เม็ด",
            weekdays: [1, 3],
          },
        ],
      }),
    ],
  };
  const text = buildCalendar(only, "th", { now }).text.replace(/\r\n /g, "");
  expect(text).toContain("DTSTART:20261102T213000");
  expect(text).toContain("BYDAY=MO,WE;UNTIL=20261231T235959");
});

it("recognises an iPhone 7 (iOS 15) as too old for web push", () => {
  const ios15 =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";
  const ios17 = ios15.replace("15_8_3", "17_5");
  expect(iosVersion(ios15)).toBeLessThan(16.4);
  expect(iosVersion(ios17)).toBeGreaterThan(16.4);
  expect(iosVersion("Mozilla/5.0 (Linux; Android 14)")).toBeUndefined();
});

import { checkCalendarText } from "../apps/api/src/calendar-link";
import { openToken, sealToken } from "../apps/api/src/secrets";

it("the calendar link accepts the app's own file and nothing else", () => {
  const { text } = buildCalendar(snapshot, "th", { now });
  expect(checkCalendarText(text)).toBe(text);
  const wrap = (extra: string) =>
    text.replace("BEGIN:VEVENT\r\n", "BEGIN:VEVENT\r\n" + extra + "\r\n");
  for (const bad of [
    "ATTACH:https://evil.example/x",
    "ORGANIZER:mailto:a@b.example",
    "URL:https://evil.example",
    "ATTENDEE:mailto:a@b.example",
    "X-APPLE-STRUCTURED-LOCATION:geo:0,0",
  ])
    expect(() => checkCalendarText(wrap(bad))).toThrow();
  expect(() => checkCalendarText("hello")).toThrow();
  expect(() => checkCalendarText(text + "x".repeat(70000))).toThrow();
  expect(() => checkCalendarText(42)).toThrow();
});

it("link tokens round-trip, hide their content and reject tampering", () => {
  process.env.PUSH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const value = { ics: "BEGIN:VCALENDAR Metformin", exp: Date.now() + 1000 };
  const token = sealToken(value);
  expect(openToken(token)).toEqual(value);
  expect(token).not.toContain("Metformin");
  expect(Buffer.from(token.slice(1), "base64url").toString()).not.toContain(
    "Metformin",
  );
  const flipped = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
  expect(() => openToken(flipped)).toThrow();
  expect(() => openToken("p" + token.slice(1))).toThrow();
  expect(() => openToken("")).toThrow();
  delete process.env.PUSH_ENCRYPTION_KEY;
});
