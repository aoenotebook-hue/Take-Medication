import { HttpError } from "./service.js";
// The phone's Calendar app opens a calendar file from a short-lived link. The
// file is made by the app on the phone, so only this fixed set of calendar
// properties is accepted; anything else (attachments, organizers, links,
// attendees) is refused so the link can never carry more than dose reminders.
const ALLOWED =
  /^(?:BEGIN:(?:VCALENDAR|VEVENT|VALARM)|END:(?:VCALENDAR|VEVENT|VALARM)|VERSION:2\.0|PRODID:[^\r\n]*|CALSCALE:GREGORIAN|METHOD:PUBLISH|X-WR-CALNAME:[^\r\n]*|UID:[^\r\n]*|DTSTAMP:\d{8}T\d{6}Z|DTSTART:\d{8}T\d{6}|DTEND:\d{8}T\d{6}|RRULE:FREQ=WEEKLY;BYDAY=(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*(?:;UNTIL=\d{8}T\d{6})?|SUMMARY:[^\r\n]*|DESCRIPTION:[^\r\n]*|TRANSP:TRANSPARENT|ACTION:DISPLAY|TRIGGER:PT\d{1,2}[MS])$/;
export const CALENDAR_LINK_SECONDS = 600;
export function checkCalendarText(ics: unknown): string {
  if (typeof ics !== "string" || ics.length > 60000)
    throw new HttpError(422, "Calendar file too large");
  const lines = ics.replace(/\r\n[ \t]/g, "").split("\r\n");
  if (lines.at(-1) === "") lines.pop();
  if (
    lines[0] !== "BEGIN:VCALENDAR" ||
    lines.at(-1) !== "END:VCALENDAR" ||
    lines.filter((l) => l === "BEGIN:VEVENT").length > 60
  )
    throw new HttpError(422, "Not a medicine calendar");
  for (const line of lines)
    if (!ALLOWED.test(line))
      throw new HttpError(422, "Calendar file has unsupported content");
  return ics;
}
