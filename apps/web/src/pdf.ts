import fontUrl from "./assets/NotoSansThai.ttf?url";
import { DateTime } from "luxon";
import { db, type Snapshot } from "./storage";
import type { Language } from "../../../packages/ui/src/i18n";
import {
  allergyLabel,
  day,
  formNames,
  productNames,
  statusLabel,
  weekdaysText,
  when,
} from "./format";
import { mealNames, mealOf } from "./autofill";
let fontPromise: Promise<string> | undefined;
export async function font() {
  fontPromise ||= (async () => {
    const cached = await db.meta.get("thai-font");
    if (cached) return cached.value as string;
    const b = await (await fetch(fontUrl)).arrayBuffer();
    let str = "";
    for (const v of new Uint8Array(b)) str += String.fromCharCode(v);
    const base64 = btoa(str);
    await db.meta.put({ key: "thai-font", value: base64 });
    return base64;
  })();
  try {
    return await fontPromise;
  } catch (e) {
    fontPromise = undefined;
    throw e;
  }
}
export function summaryRows(s: Snapshot) {
  const at = Date.now();
  return s.medications.map((m) => {
    const versions = s.regimens
      .filter((r) => r.medication_id === m.id)
      .sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at));
    const current = versions
      .filter((r) => Date.parse(r.effective_at) <= at)
      .at(-1);
    const future = versions.filter((r) => Date.parse(r.effective_at) > at);
    return { medicine: m, current, future };
  });
}
export type SummaryItem = {
  id: string;
  title: string;
  how: string;
  times: string;
  extra: string[];
  flags: string[];
};
/** Plain-language lines for one medicine; the screen and the PDF both use these. */
export function describe(
  row: ReturnType<typeof summaryRows>[number],
  lang: Language,
  zone: string,
): SummaryItem {
  const th = lang === "th";
  const { medicine: m, current: r, future } = row;
  const d = r?.data;
  const slots: any[] = [...(d?.slots || [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const sameAmount = slots.every(
    (x) => x.amount === slots[0]?.amount && x.unit === slots[0]?.unit,
  );
  const route = d?.route || m.data.route;
  const how = [
    !slots.length && d?.prnAmount
      ? `${route || ""} ${th ? "ครั้งละ" : ""} ${d.prnAmount} ${d.prnUnit || ""}`
          .replace(/\s+/g, " ")
          .trim()
      : "",
    slots.length && sameAmount
      ? `${route || ""} ${th ? "ครั้งละ" : ""} ${slots[0].amount} ${slots[0].unit}`
          .replace(/\s+/g, " ")
          .trim()
      : route,
    d?.status === "as-needed"
      ? [
          th ? "เมื่อจำเป็น" : "when needed",
          d.prnIndication,
          d.prnInterval,
          d.prnMaximum && (th ? "สูงสุด " : "max ") + d.prnMaximum,
        ]
          .filter(Boolean)
          .join(" ")
      : "",
    d?.food,
  ]
    .filter(Boolean)
    .join(" · ");
  const times = slots.length
    ? slots
        .map((x) => {
          const meal = mealOf(x.time);
          return (
            (meal ? mealNames[lang][meal] + " " : "") +
            x.time +
            (sameAmount ? "" : ` (${x.amount} ${x.unit})`)
          );
        })
        .join(" · ") +
      " · " +
      weekdaysText(slots[0].weekdays || [1, 2, 3, 4, 5, 6, 7], lang)
    : "";
  const extra = [
    [m.data.generic, m.data.brand].filter(Boolean).join(" / "),
    m.data.purpose && (th ? "ใช้สำหรับ " : "For ") + m.data.purpose,
    m.data.productType !== "prescription"
      ? productNames[lang][m.data.productType]
      : "",
    m.data.form && m.data.form !== "tablet" ? formNames[lang][m.data.form] : "",
    d?.start &&
      (th ? "เริ่ม " : "From ") +
        day(d.start, lang) +
        (d.end ? (th ? " ถึง " : " to ") + day(d.end, lang) : ""),
    (d?.source || m.data.source) &&
      (th ? "จาก " : "Source: ") + (d?.source || m.data.source),
    d?.instructions && !how.includes(d.instructions)
      ? (th ? "ฉลาก: " : "Label: ") + d.instructions
      : "",
  ].filter(Boolean) as string[];
  const flags = [
    !d || ["draft", "reference"].includes(d.status)
      ? th
        ? "ข้อมูลยังไม่ครบ / ไม่มีการแจ้งเตือน"
        : "Incomplete / no reminders"
      : "",
    r?.pending
      ? th
        ? "มีการแก้ไขที่ยังไม่ซิงค์"
        : "Change not yet synced"
      : "",
    ...future.map(
      (f: any) =>
        (th ? "จะเปลี่ยนเมื่อ " : "Changes on ") +
        when(f.effective_at, lang, zone) +
        ": " +
        (f.data.instructions || statusLabel(f.data.status, lang)),
    ),
  ].filter(Boolean);
  return {
    id: m.id,
    title: m.data.name + (m.data.strength ? " " + m.data.strength : ""),
    how,
    times,
    extra,
    flags,
  };
}
/** Groups for the doctor summary: current, as-needed, incomplete, recent stops. */
export function summarySections(s: Snapshot, lang: Language) {
  const th = lang === "th";
  const zone = s.profile.data.timezone || "Asia/Bangkok";
  const rows = summaryRows(s).sort((a, b) =>
    a.medicine.data.name.localeCompare(b.medicine.data.name, undefined, {
      numeric: true,
    }),
  );
  const status = (r: any) => r.current?.data.status || "draft";
  const recent = (r: any) =>
    Date.parse(r.current?.effective_at || 0) > Date.now() - 30 * 86400000;
  const group = (title: string, list: typeof rows) => ({
    title,
    items: list.map((r) => describe(r, lang, zone)),
  });
  return [
    group(
      th ? "ยาที่ใช้อยู่" : "Current medicines",
      rows.filter((r) => status(r) === "active"),
    ),
    group(
      th ? "ยาที่ใช้เมื่อจำเป็น" : "As-needed medicines",
      rows.filter((r) => status(r) === "as-needed"),
    ),
    group(
      th ? "ข้อมูลยังไม่ครบ (แบบร่าง)" : "Incomplete records",
      rows.filter((r) => ["draft", "reference"].includes(status(r))),
    ),
    group(
      th
        ? "หยุดหรือพักยาใน 30 วันที่ผ่านมา"
        : "Stopped or paused in the last 30 days",
      rows.filter(
        (r) => ["paused", "stopped"].includes(status(r)) && recent(r),
      ),
    ),
  ].filter((g) => g.items.length);
}
export const disclaimer = {
  th: "รายการยาที่ผู้ป่วยหรือผู้ดูแลบันทึกเอง โปรดตรวจสอบกับใบสั่งยาและยาที่ใช้จริง",
  en: "Patient/caregiver-reported medication list. Please reconcile with prescriptions and actual medicines.",
};
export function buildSummaryDocument(
  s: Snapshot,
  pending: boolean,
  lang: Language = "th",
) {
  const th = lang === "th";
  const p = s.profile.data;
  const zone = p.timezone || "Asia/Bangkok";
  const sections = summarySections(s, lang);
  const allergies =
    allergyLabel(p.allergyStatus, lang) +
    (p.allergies?.length
      ? ": " +
        p.allergies
          .map((a: any) =>
            [a.substance, a.reaction && `(${a.reaction})`]
              .filter(Boolean)
              .join(" "),
          )
          .join(", ")
      : "");
  const doc: any = {
    info: { title: (th ? "รายการยา " : "Medication list ") + p.displayName },
    defaultStyle: { font: "Thai", fontSize: 12, lineHeight: 1.15 },
    pageMargins: [32, 36, 32, 40],
    content: [
      {
        text: th ? "รายการยา (Medication list)" : "Medication list",
        fontSize: 20,
        bold: true,
      },
      { text: p.displayName, fontSize: 16, margin: [0, 2, 0, 0] },
      {
        text: [
          (th ? "วันเกิด: " : "Date of birth: ") + day(p.dob, lang),
          "   ·   " +
            (th ? "พิมพ์เมื่อ: " : "Printed: ") +
            DateTime.now()
              .setZone(zone)
              .setLocale(lang)
              .toLocaleString(DateTime.DATETIME_MED),
        ],
        color: "#444444",
      },
      {
        table: {
          widths: ["*"],
          body: [
            [
              {
                text: (th ? "ประวัติแพ้ยา: " : "Allergies: ") + allergies,
                fontSize: 14,
                fillColor: p.allergyStatus === "known" ? "#fde7e4" : "#eef3f0",
              },
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 8, 0, 4],
      },
      { text: disclaimer[lang], italics: true, fontSize: 10, color: "#555555" },
      pending
        ? {
            text: th
              ? "มีการแก้ไขในโทรศัพท์ที่ยังไม่ได้ซิงค์กับเซิร์ฟเวอร์"
              : "Some changes on this phone are not yet synced",
            color: "#9a4d0a",
            fontSize: 10,
          }
        : {
            text:
              (th ? "ข้อมูล ณ " : "Data as of ") + when(s.serverAt, lang, zone),
            fontSize: 10,
            color: "#555555",
          },
      ...(sections.length
        ? sections.flatMap((g) => [
            { text: g.title, fontSize: 15, bold: true, margin: [0, 12, 0, 4] },
            {
              table: {
                headerRows: 1,
                widths: ["32%", "40%", "28%"],
                body: [
                  [
                    th ? "ยา" : "Medicine",
                    th ? "วิธีใช้" : "How to use",
                    th ? "เวลา" : "When",
                  ].map((text) => ({ text, bold: true, fillColor: "#e4eee7" })),
                  ...g.items.map((it) => [
                    {
                      stack: [
                        { text: it.title, bold: true, fontSize: 13 },
                        ...it.extra
                          .slice(0, 2)
                          .map((text) => ({ text, fontSize: 10 })),
                      ],
                    },
                    {
                      stack: [
                        it.how || "—",
                        ...it.extra
                          .slice(2)
                          .map((text) => ({ text, fontSize: 10 })),
                        ...it.flags.map((text) => ({
                          text: "• " + text,
                          fontSize: 10,
                          color: "#9a4d0a",
                        })),
                      ],
                    },
                    it.times || "—",
                  ]),
                ],
              },
              layout: "lightHorizontalLines",
            },
          ])
        : [
            {
              text: th ? "ยังไม่มีรายการยา" : "No medicines recorded",
              margin: [0, 12, 0, 0],
            },
          ]),
    ],
    footer: (page: number, total: number) => ({
      text: `${p.displayName} · ${page} / ${total}`,
      alignment: "center",
      font: "Thai",
      fontSize: 9,
      color: "#555555",
    }),
  };
  return doc;
}
export async function exportPdf(s: Snapshot, pending: boolean, lang: Language) {
  const pdfMake = (await import("pdfmake/build/pdfmake")).default;
  const fontData = await font();
  pdfMake.addVirtualFileSystem({ "NotoSansThai.ttf": fontData });
  pdfMake.fonts = {
    Thai: {
      normal: "NotoSansThai.ttf",
      bold: "NotoSansThai.ttf",
      italics: "NotoSansThai.ttf",
      bolditalics: "NotoSansThai.ttf",
    },
  };
  const name = "medicines-" + DateTime.now().toFormat("yyyy-MM-dd") + ".pdf";
  const pdf = pdfMake.createPdf(buildSummaryDocument(s, pending, lang));
  const file = new File([await pdf.getBlob()], name, {
    type: "application/pdf",
  });
  // iPhone Home Screen apps cannot reliably download files; the share sheet
  // offers Save to Files, Print, LINE and AirDrop instead.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e: any) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  await pdf.download(name);
  return "downloaded";
}
