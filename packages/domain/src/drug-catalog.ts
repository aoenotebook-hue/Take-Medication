import type { DrugCard } from "./drug-information.js";
import { normalizeDrugQuery } from "./drug-information.js";

// Original concise summaries, based on the linked NHS pages checked 2026-10-28.
// These are ingredient education, NOT product identification or clinical review.
const entries = [
  [
    "metformin",
    "เมตฟอร์มิน",
    "Helps lower blood sugar in type 2 diabetes.",
    "ช่วยลดระดับน้ำตาลในเลือดในการรักษาเบาหวานชนิดที่ 2",
    "metformin/",
  ],
  [
    "amlodipine",
    "แอมโลดิพีน",
    "Used for high blood pressure and to prevent angina (chest pain caused by reduced blood flow to the heart).",
    "ใช้รักษาความดันโลหิตสูง และป้องกันอาการเจ็บหน้าอกจากเลือดไปเลี้ยงหัวใจไม่เพียงพอ",
    "amlodipine/",
  ],
  [
    "atorvastatin",
    "อะทอร์วาสแตติน",
    "Lowers cholesterol and helps reduce the risk of heart attacks and strokes in people prescribed it for cardiovascular risk.",
    "ช่วยลดคอเลสเตอรอล และลดความเสี่ยงหัวใจขาดเลือดและโรคหลอดเลือดสมองในผู้ที่แพทย์สั่งยาเพื่อลดความเสี่ยงนี้",
    "atorvastatin/",
  ],
  [
    "losartan",
    "โลซาร์แทน",
    "Used for high blood pressure, heart failure, and kidney disease associated with type 2 diabetes.",
    "ใช้รักษาความดันโลหิตสูง ภาวะหัวใจล้มเหลว และโรคไตที่เกี่ยวข้องกับเบาหวานชนิดที่ 2",
    "losartan/",
  ],
  [
    "omeprazole",
    "โอเมพราโซล",
    "Reduces stomach acid. Used for heartburn, acid reflux and stomach ulcers; it has other uses with additional medicines.",
    "ช่วยลดกรดในกระเพาะอาหาร ใช้รักษาอาการแสบร้อนกลางอก กรดไหลย้อน และแผลในกระเพาะอาหาร และอาจใช้ร่วมกับยาอื่นตามที่แพทย์สั่ง",
    "omeprazole/",
  ],
  [
    "paracetamol",
    "พาราเซตามอล",
    "Relieves pain and fever. The linked source covers adult use; it does not supply this patient's dose.",
    "ใช้บรรเทาปวดและลดไข้ แหล่งอ้างอิงนี้เป็นข้อมูลสำหรับผู้ใหญ่ และไม่ได้ระบุขนาดยาสำหรับผู้ป่วยรายนี้",
    "paracetamol-for-adults/",
  ],
  [
    "cetirizine",
    "เซทิริซีน",
    "An antihistamine used to relieve allergy symptoms, including hay fever and hives.",
    "เป็นยาแก้แพ้ ใช้บรรเทาอาการภูมิแพ้ เช่น อาการแพ้ละอองเกสรและลมพิษ",
    "cetirizine/about-cetirizine/",
  ],
] as const;
export const drugCatalog: (DrugCard & { aliases: string[] })[] = entries.map(
  ([name, thai, en, th, path]) => ({
    id: "catalog:" + name,
    name,
    ingredients: [name],
    scope: "ingredient",
    aliases: [
      name,
      thai,
      ...(name === "paracetamol" ? ["acetaminophen", "พาราเซตตามอล"] : []),
    ],
    description: "Ingredient information; not an exact product match",
    uses: { th, en },
    publisher: "NHS",
    country: "UK",
    sourceUrl: "https://www.nhs.uk/medicines/" + path,
    sourceDate: null,
    checkedAt: "2026-10-28T00:00:00.000Z",
    validUntil: "2027-01-26T00:00:00.000Z",
    review: "source-summary-not-clinically-reviewed",
  }),
);
export function searchCatalog(query: string) {
  const q = normalizeDrugQuery(query);
  // Exact aliases only. No substring guessing, brand mapping or combination splitting.
  return drugCatalog.filter((c) =>
    c.aliases.some((a) => normalizeDrugQuery(a) === q),
  );
}
