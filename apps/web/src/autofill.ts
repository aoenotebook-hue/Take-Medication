// Suggestions that fill the medicine form from what the user types. Everything
// stays visible and editable, and the user confirms it before reminders start.
// Nothing here chooses a dose: amounts come only from the user's label text or taps.

export type Meal = "morning" | "noon" | "evening" | "bedtime";
export const MEALS: Meal[] = ["morning", "noon", "evening", "bedtime"];
export const mealNames: Record<"th" | "en", Record<Meal, string>> = {
  th: { morning: "เช้า", noon: "กลางวัน", evening: "เย็น", bedtime: "ก่อนนอน" },
  en: {
    morning: "Morning",
    noon: "Noon",
    evening: "Evening",
    bedtime: "Bedtime",
  },
};
const mealTimes: Record<Meal, string> = {
  morning: "08:00",
  noon: "12:00",
  evening: "18:00",
  bedtime: "21:00",
};
/** Usual clock time for a meal; 30 minutes earlier when taken before food. */
export function mealTime(meal: Meal, food = "") {
  const base = mealTimes[meal];
  if (meal === "bedtime" || !/ก่อนอาหาร|before/i.test(food)) return base;
  const [h, m] = base.split(":").map(Number);
  const total = h * 60 + m - 30;
  return (
    String(Math.floor(total / 60)).padStart(2, "0") +
    ":" +
    String(total % 60).padStart(2, "0")
  );
}
export { periodOf } from "../../../packages/domain/src";
export const mealIcons: Record<Meal, string> = {
  morning: "🌅",
  noon: "☀️",
  evening: "🌇",
  bedtime: "🌙",
};
export function mealOf(time: string): Meal | undefined {
  return MEALS.find(
    (meal) => mealTime(meal) === time || mealTime(meal, "ก่อนอาหาร") === time,
  );
}

export const units = {
  th: ["เม็ด", "แคปซูล", "มล.", "ช้อนชา", "หยด", "พ่น", "ซอง", "ยูนิต"],
  en: ["tablet", "capsule", "mL", "teaspoon", "drop", "puff", "sachet", "unit"],
};
/** Form and route that a dose unit implies (shown, editable under More details). */
export function formForUnit(unit: string): {
  form: string;
  route: { th: string; en: string };
} {
  const u = unit.toLowerCase();
  if (/แคปซูล|capsule/.test(u))
    return { form: "capsule", route: { th: "รับประทาน", en: "By mouth" } };
  if (/มล|ซีซี|ช้อน|ml|cc|spoon/.test(u))
    return { form: "liquid", route: { th: "รับประทาน", en: "By mouth" } };
  if (/หยด|drop/.test(u))
    return { form: "drops", route: { th: "หยอด", en: "Drops" } };
  if (/พ่น|สูด|puff|inhal/.test(u))
    return { form: "inhaler", route: { th: "สูดพ่น", en: "Inhale" } };
  if (/ยูนิต|unit|เข็ม|inject/.test(u))
    return { form: "injection", route: { th: "ฉีด", en: "Injection" } };
  if (/ทา|apply|cream/.test(u))
    return { form: "topical", route: { th: "ทา", en: "Apply on skin" } };
  if (/ซอง|sachet/.test(u))
    return { form: "other", route: { th: "รับประทาน", en: "By mouth" } };
  return { form: "tablet", route: { th: "รับประทาน", en: "By mouth" } };
}

export const foodOptions = {
  th: ["ก่อนอาหาร 30 นาที", "หลังอาหาร", "พร้อมอาหาร", "ไม่ขึ้นกับมื้ออาหาร"],
  en: ["30 minutes before meals", "After meals", "With meals", "Any time"],
};

const words: Record<string, string> = {
  ครึ่ง: "1/2",
  หนึ่ง: "1",
  สอง: "2",
  สาม: "3",
  half: "1/2",
  "½": "1/2",
  one: "1",
  two: "2",
  three: "3",
};
const unitPattern =
  "เม็ด|แคปซูล|ช้อนชา|ช้อนโต๊ะ|มล\\.?|ซีซี|หยด|พ่น|ซอง|ยูนิต|tablets?|caps(?:ule)?s?|ml|drops?|puffs?|teaspoons?|sachets?|units?";

export type LabelFill = {
  amount?: string;
  unit?: string;
  meals?: Meal[];
  food?: string;
  asNeeded?: boolean;
  route?: string;
  interval?: string;
};

/** Reads common Thai/English pharmacy label wording. Returns only what it finds. */
export function readLabel(text: string): LabelFill {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return {};
  const out: LabelFill = {};
  // A range ("1-2 เม็ด") is the prescriber's choice; never pick a number from it.
  const range = s.match(
    new RegExp("\\d+\\s*[-–]\\s*\\d+\\s*(" + unitPattern + ")", "i"),
  );
  const dose = range
    ? null
    : s.match(
        new RegExp(
          "(?:ครั้งละ|take|use)?\\s*(\\d+(?:\\.\\d+)?|\\d+\\/\\d+|½|ครึ่ง|หนึ่ง|สอง|สาม|half|one|two|three)\\s*(" +
            unitPattern +
            ")",
          "i",
        ),
      );
  if (dose) {
    out.amount = words[dose[1].toLowerCase()] || dose[1];
    const unit = dose[2].toLowerCase();
    out.unit = /^มล/.test(unit)
      ? "มล."
      : /^tablet/.test(unit)
        ? "tablet"
        : /^cap/.test(unit) && !/แคปซูล/.test(unit)
          ? "capsule"
          : /^drop/.test(unit)
            ? "drop"
            : /^puff/.test(unit)
              ? "puff"
              : /^teaspoon/.test(unit)
                ? "teaspoon"
                : /^sachet/.test(unit)
                  ? "sachet"
                  : /^units?$/.test(unit)
                    ? "unit"
                    : dose[2];
  } else if (range) {
    out.unit = /^มล/.test(range[1]) ? "มล." : range[1];
  } else if (/ครึ่งเม็ด/.test(s)) {
    out.amount = "1/2";
    out.unit = "เม็ด";
  }
  const meals: Meal[] = [];
  if (/เช้า|morning|breakfast/i.test(s)) meals.push("morning");
  if (/กลางวัน|เที่ยง|noon|lunch|midday/i.test(s)) meals.push("noon");
  if (/เย็น|evening|dinner|supper/i.test(s)) meals.push("evening");
  if (/ก่อนนอน|bedtime|at night/i.test(s)) meals.push("bedtime");
  const perDay = s.match(
    /(?:วันละ|(\d)\s*(?:times|x)\s*(?:a|per)\s*day)\s*(\d)?\s*(?:ครั้ง)?/i,
  );
  const count = Number(perDay?.[2] || perDay?.[1] || 0);
  if (!meals.length && count >= 1 && count <= 4)
    meals.push(
      ...(
        [
          ["morning"],
          ["morning", "evening"],
          ["morning", "noon", "evening"],
          ["morning", "noon", "evening", "bedtime"],
        ] as Meal[][]
      )[count - 1],
    );
  if (/once (?:a )?daily|once a day/i.test(s) && !meals.length)
    meals.push("morning");
  if (meals.length) out.meals = meals;
  const before = s.match(
    /ก่อนอาหาร(?:\s*(?:เช้า|กลางวัน|เที่ยง|เย็น)?\s*(\d+)\s*นาที)?/,
  );
  if (before)
    out.food = before[1] ? `ก่อนอาหาร ${before[1]} นาที` : "ก่อนอาหาร";
  else if (/หลังอาหารทันที/.test(s)) out.food = "หลังอาหารทันที";
  else if (/หลังอาหาร/.test(s)) out.food = "หลังอาหาร";
  else if (/พร้อมอาหาร/.test(s)) out.food = "พร้อมอาหาร";
  else if (/before (?:meals?|food)/i.test(s)) out.food = "Before meals";
  else if (/after (?:meals?|food)/i.test(s)) out.food = "After meals";
  else if (/with (?:meals?|food)/i.test(s)) out.food = "With meals";
  if (
    /เมื่อมีอาการ|เมื่อจำเป็น|เวลา(?:ปวด|ไข้|มีอาการ)|เมื่อปวด|เมื่อ(?:มี)?ไข้|as needed|when needed|\bprn\b/i.test(
      s,
    )
  )
    out.asNeeded = true;
  const every = s.match(
    /ทุก\s*(\d+)\s*(?:-\s*\d+\s*)?ชั่วโมง|every\s*(\d+)\s*hours?/i,
  );
  if (every) out.interval = every[0];
  if (/หยอดตา/.test(s)) out.route = "หยอดตา";
  else if (/หยอดหู/.test(s)) out.route = "หยอดหู";
  else if (/รับประทาน|กิน/.test(s)) out.route = "รับประทาน";
  else if (/ทา(?:บาง|ที่|บริเวณ|ผิว)/.test(s)) out.route = "ทา";
  else if (/สูด|พ่น/.test(s)) out.route = "สูดพ่น";
  else if (/ฉีด/.test(s)) out.route = "ฉีด";
  else if (/by mouth|orally/i.test(s)) out.route = "By mouth";
  return out;
}

/** Spelling help only; the list never fills a dose. */
export const commonMedicines = [
  "Allopurinol",
  "Amlodipine",
  "Aspirin",
  "Atenolol",
  "Atorvastatin",
  "Calcium carbonate",
  "Carvedilol",
  "Clopidogrel",
  "Domperidone",
  "Empagliflozin",
  "Enalapril",
  "Ferrous fumarate",
  "Folic acid",
  "Furosemide",
  "Gabapentin",
  "Gliclazide",
  "Glipizide",
  "Hydralazine",
  "Hydrochlorothiazide",
  "Insulin",
  "Isosorbide dinitrate",
  "Levothyroxine",
  "Losartan",
  "Manidipine",
  "Metformin",
  "Metoprolol",
  "Omeprazole",
  "Paracetamol",
  "Pioglitazone",
  "Propranolol",
  "Rosuvastatin",
  "Senna",
  "Simvastatin",
  "Sitagliptin",
  "Spironolactone",
  "Tamsulosin",
  "Vitamin B complex",
  "Vitamin D2 (Ergocalciferol)",
  "Warfarin",
];
