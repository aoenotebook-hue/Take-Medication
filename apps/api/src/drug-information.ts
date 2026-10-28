import { z } from "zod";
import {
  drugCardSchema,
  type DrugCard,
  type DrugSearch,
} from "../../../packages/domain/src/drug-information.js";
import {
  searchCatalog,
  drugCatalog,
} from "../../../packages/domain/src/drug-catalog.js";

const uuid = z.string().uuid();
const textList = z.array(z.string().max(12000)).max(30);
const labelSchema = z.object({
  set_id: uuid,
  effective_time: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  indications_and_usage: textList.optional(),
  purpose: textList.optional(),
  dosage_forms_and_strengths: textList.optional(),
  openfda: z.object({
    generic_name: textList.min(1),
    brand_name: textList.optional(),
    route: textList.optional(),
    product_type: textList,
    manufacturer_name: textList.optional(),
  }),
});
const responseSchema = z.object({ results: z.array(z.unknown()).max(10) });
export function labelCard(input: unknown): DrugCard | undefined {
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return;
  const l = parsed.data;
  if (
    !l.openfda.product_type.some((t) =>
      ["HUMAN PRESCRIPTION DRUG", "HUMAN OTC DRUG"].includes(t),
    )
  )
    return;
  const uses = (
    l.indications_and_usage?.length ? l.indications_and_usage : l.purpose || []
  ).join("\n\n");
  if (!uses.trim()) return;
  const plain = (s: string) =>
    s.replace(/<[^>]*>/g, "").replace(/[\u0000-\u0008]/g, "");
  // Provider records are independent. A malformed normalized card must not
  // discard every otherwise valid result in the same response.
  const card = drugCardSchema.safeParse({
    id: "label:" + l.set_id,
    name: (
      l.openfda.brand_name?.[0] ||
      l.openfda.generic_name[0] ||
      "Drug label"
    ).slice(0, 300),
    ingredients: l.openfda.generic_name
      .map((s) => plain(s).slice(0, 300))
      .slice(0, 20),
    scope: "label",
    description: plain(
      [
        ...(l.openfda.route || []),
        ...(l.dosage_forms_and_strengths || []),
        ...(l.openfda.manufacturer_name || []),
      ].join(" · "),
    ).slice(0, 800),
    uses: { en: plain(uses).slice(0, 12000) },
    publisher: "openFDA / DailyMed",
    country: "US",
    sourceUrl:
      "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=" + l.set_id,
    sourceDate: l.effective_time
      ? l.effective_time.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
      : null,
    checkedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    review: "source-summary-not-clinically-reviewed",
  });
  return card.success ? card.data : undefined;
}
// Every URL is constructed here; no patient identity, purpose, URL or full regimen
// is passed upstream. Injectable fetch makes contracts testable without live requests.
async function labels(
  search: string,
  fetcher: typeof fetch,
): Promise<DrugCard[]> {
  const u = new URL("https://api.fda.gov/drug/label.json");
  u.searchParams.set("search", search);
  u.searchParams.set("limit", "10");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetcher(u, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (r.status === 404) return [];
    if (!r.ok || !r.headers.get("content-type")?.includes("application/json"))
      throw new Error("Source unavailable");
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Source unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1048576) throw new Error("Source response too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data = responseSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return data.results.flatMap((l) => {
      const c = labelCard(l);
      return c ? [c] : [];
    });
  } finally {
    clearTimeout(timer);
  }
}
const quote = (s: string) =>
  '"' +
  s
    .replace(/[+\-=&|><!(){}\[\]^"~*?:\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim() +
  '"';
export async function searchDrugInformation(
  query: string,
  remote: boolean,
  fetcher: typeof fetch = fetch,
): Promise<DrugSearch> {
  const cards: DrugCard[] = searchCatalog(query).map((c) =>
    drugCardSchema.parse(c),
  );
  if (!remote) return { cards, provider: "not-requested" };
  try {
    const term = quote(query);
    const found = await labels(
      `(openfda.generic_name:${term} OR openfda.brand_name:${term})`,
      fetcher,
    );
    return { cards: [...cards, ...found], provider: "available" };
  } catch {
    return { cards, provider: "unavailable" };
  }
}
export async function getDrugInformation(
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const local = drugCatalog.find((c) => c.id === id);
  if (local) return drugCardSchema.parse(local);
  const parsed = uuid.safeParse(id.replace(/^label:/, ""));
  if (!id.startsWith("label:") || !parsed.success) return undefined;
  return (await labels(`set_id:"${parsed.data}"`, fetcher)).find(
    (c) => c.id === id,
  );
}
