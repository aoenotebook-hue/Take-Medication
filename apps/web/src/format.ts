import { DateTime } from "luxon";
import { words, type Language } from "../../../packages/ui/src/i18n";
// Shared by the screens and the PDF so both show the same readable wording.
export const weekdayNames = {
  th: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
export const formNames: Record<Language, Record<string, string>> = {
  th: {
    tablet: "ยาเม็ด",
    capsule: "แคปซูล",
    liquid: "ยาน้ำ",
    drops: "ยาหยอด",
    injection: "ยาฉีด",
    inhaler: "ยาสูดพ่น",
    topical: "ยาใช้ภายนอก",
    other: "อื่น ๆ",
  },
  en: {
    tablet: "Tablet",
    capsule: "Capsule",
    liquid: "Liquid",
    drops: "Drops",
    injection: "Injection",
    inhaler: "Inhaler",
    topical: "Topical",
    other: "Other",
  },
};
export const productNames: Record<Language, Record<string, string>> = {
  th: {
    prescription: "ยาตามใบสั่งแพทย์",
    nonprescription: "ยาที่ซื้อเอง",
    supplement: "อาหารเสริม / สมุนไพร",
  },
  en: {
    prescription: "Prescription",
    nonprescription: "Non-prescription",
    supplement: "Supplement / herbal",
  },
};
export function weekdaysText(days: number[], lang: Language) {
  if (days.length === 7) return words[lang].everyDay;
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => weekdayNames[lang][d - 1])
    .join(" ");
}
export function when(
  iso: string | undefined,
  lang: Language,
  zone = "Asia/Bangkok",
) {
  if (!iso) return "—";
  const d = DateTime.fromISO(iso, { zone });
  return d.isValid
    ? d.setLocale(lang).toLocaleString(DateTime.DATETIME_MED)
    : iso;
}
export function day(date: string | undefined, lang: Language) {
  if (!date) return "—";
  const d = DateTime.fromISO(date);
  return d.isValid ? d.setLocale(lang).toLocaleString(DateTime.DATE_MED) : date;
}
export function statusLabel(status: string, lang: Language) {
  const t = words[lang] as Record<string, string>;
  return status === "unconfirmed"
    ? t.unconfirmed
    : t[status + "Status"] || t[status] || status;
}
const allergyNames: Record<Language, Record<string, string>> = {
  th: {
    unknown: "ไม่ทราบ / ยังไม่ได้บันทึก",
    "none-known": "ไม่มีประวัติแพ้ยา",
    known: "มีประวัติแพ้ยา",
  },
  en: {
    unknown: "Unknown / not recorded",
    "none-known": "No known allergies",
    known: "Known allergies",
  },
};
export const allergyLabel = (status: string, lang: Language) =>
  allergyNames[lang][status] || status;
