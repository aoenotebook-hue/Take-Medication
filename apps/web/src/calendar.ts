// Calendar reminders for phones that cannot receive web push (iPhone 7 and
// every iPhone below iOS 16.4). The calendar app rings by itself, so nothing
// here needs the server or a network.
import { DateTime } from "luxon";
import type { Language } from "../../../packages/ui/src/i18n";
import { drugUse } from "../../../packages/domain/src/drug-uses";
import { periodOf, periodNames } from "../../../packages/domain/src";
import { summaryRows } from "./pdf";
import type { Snapshot } from "./storage";

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/** Minutes after the dose time at which the calendar alerts again. */
export const REPEAT_ALERTS = [0, 10, 20];

const esc = (v: string) =>
  v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/** Fold at 73 bytes (RFC 5545) without splitting a character. */
function fold(line: string) {
  const out: string[] = [];
  let cur = "",
    bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 73) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** True when this browser cannot receive web push reminders at all. */
export function pushUnavailable() {
  return (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    typeof Notification === "undefined"
  );
}
/** iOS version from the user agent, e.g. 15.8 on an iPhone 7. */
export function iosVersion(ua = navigator.userAgent): number | undefined {
  const m = ua.match(/OS (\d+)[_.](\d+)/);
  return /iPhone|iPad|iPod/.test(ua) && m
    ? Number(m[1]) + Number(m[2]) / 100
    : undefined;
}

/**
 * One repeating calendar event per dose time (and set of weekdays), with the
 * medicines listed in the notes. Medicine names are left out when `hideNames`
 * is on, because calendar alerts appear on the lock screen.
 */
export function buildCalendar(
  s: Pick<
    Snapshot,
    "medications" | "regimens" | "profile" | "automaticInformation"
  >,
  lang: Language,
  options: { hideNames?: boolean; now?: DateTime } = {},
) {
  const th = lang === "th";
  const now = options.now || DateTime.now();
  const names = periodNames[th ? "th" : "en"];
  const groups = new Map<
    string,
    {
      time: string;
      days: number[];
      lines: string[];
      start: string;
      end?: string;
    }
  >();
  for (const row of summaryRows(s as Snapshot)) {
    const r = row.current;
    if (!r || r.data.status !== "active") continue;
    for (const slot of r.data.slots as any[]) {
      const days = [...slot.weekdays].sort((a: number, b: number) => a - b);
      const key = slot.time + "|" + days.join("");
      const g = groups.get(key) || {
        time: slot.time as string,
        days: days as number[],
        lines: [] as string[],
        start: r.data.start,
        end: r.data.end,
      };
      const use = drugUse(
        row.medicine.data,
        s.automaticInformation?.find(
          (a) => a.medication_id === row.medicine.id,
        ),
        lang,
      );
      g.lines.push(
        "• " +
          [row.medicine.data.name, row.medicine.data.strength]
            .filter(Boolean)
            .join(" ") +
          " — " +
          slot.amount +
          " " +
          slot.unit +
          (use
            ? "\n  " +
              (use.kind === "general"
                ? th
                  ? "ใช้ทั่วไป: "
                  : "Common use: "
                : th
                  ? "เหตุผลที่บันทึก: "
                  : "Recorded reason: ") +
              use.text
            : ""),
      );
      // Several medicines at one time share the earliest start / latest end.
      if (r.data.start < g.start) g.start = r.data.start;
      if (!r.data.end || (g.end && r.data.end > g.end)) g.end = r.data.end;
      groups.set(key, g);
    }
  }
  const stamp = now.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My Medicine//TH//",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(th ? "ยาของฉัน" : "My Medicine"),
  ];
  for (const g of [...groups.values()].sort((a, b) =>
    a.time.localeCompare(b.time),
  )) {
    const first = DateTime.fromISO(
      g.start > now.toISODate()! ? g.start : now.toISODate()!,
    );
    const title =
      "💊 " +
      (th ? "ถึงเวลาใช้ยา" : "Medicine time") +
      " · " +
      names[periodOf(g.time)] +
      " " +
      g.time;
    const body = options.hideNames
      ? th
        ? "เปิดแอป ยาของฉัน เพื่อดูรายการยา"
        : "Open My Medicine to see your medicines"
      : g.lines.join("\n");
    const [h, m] = g.time.split(":");
    const day = first.toFormat("yyyyLLdd");
    const end = DateTime.fromISO(day)
      .set({ hour: Number(h), minute: Number(m) })
      .plus({ minutes: 10 });
    lines.push(
      "BEGIN:VEVENT",
      "UID:" +
        s.profile.id +
        "-" +
        g.time.replace(":", "") +
        "-" +
        g.days.join("") +
        "@my-medicine",
      "DTSTAMP:" + stamp,
      // Floating local time: it rings at 08:00 wherever the phone is.
      "DTSTART:" + day + "T" + h + m + "00",
      "DTEND:" + end.toFormat("yyyyLLdd'T'HHmmss"),
      "RRULE:FREQ=WEEKLY;BYDAY=" +
        g.days.map((d) => DAYS[d - 1]).join(",") +
        (g.end ? ";UNTIL=" + g.end.replace(/-/g, "") + "T235959" : ""),
      "SUMMARY:" + esc(title),
      "DESCRIPTION:" + esc(body),
      "TRANSP:TRANSPARENT",
    );
    for (const after of REPEAT_ALERTS)
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:" + esc(title + "\n" + body),
        after === 0 ? "TRIGGER:PT0S" : "TRIGGER:PT" + after + "M",
        "END:VALARM",
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", events: groups.size };
}

/** Hands the file to the phone: share sheet first, then opening it directly. */
export async function openCalendar(text: string, name: string) {
  const file = new File([text], name, { type: "text/calendar" });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return "shared";
    } catch (e: any) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  // Safari offers "Add to Calendar" for a calendar file it is asked to open.
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "opened";
}
