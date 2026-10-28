import { z } from "zod";

export const drugCardSchema = z.object({
  id: z.string().regex(/^(catalog:[a-z]+|label:[a-f0-9-]{36})$/),
  name: z.string().min(1).max(300),
  ingredients: z.array(z.string().min(1).max(300)).min(1).max(20),
  scope: z.enum(["ingredient", "label"]),
  description: z.string().max(800),
  uses: z.object({
    th: z.string().max(4000).optional(),
    en: z.string().max(12000),
  }),
  publisher: z.string().max(100),
  country: z.string().max(30),
  sourceUrl: z.string().url().refine(safeDrugSource),
  sourceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  checkedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  review: z.literal("source-summary-not-clinically-reviewed"),
});
export type DrugCard = z.infer<typeof drugCardSchema>;
export type DrugSearch = {
  cards: DrugCard[];
  provider: "available" | "unavailable" | "not-requested";
};
export type DrugIdentity = {
  name: string;
  generic?: string;
  brand?: string;
  strength?: string;
  form?: string;
  route?: string;
  productType?: string;
};
// Purpose, patient information, instructions and dose amounts never enter a lookup.
export function identityKey(m: DrugIdentity) {
  return JSON.stringify([
    m.name,
    m.generic || "",
    m.brand || "",
    m.strength || "",
    m.form || "",
    m.route || "",
    m.productType || "",
  ]);
}
export function normalizeDrugQuery(s: string) {
  return s
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}
export function safeDrugSource(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["www.nhs.uk", "drug.fda.moph.go.th", "dailymed.nlm.nih.gov"].includes(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
}
