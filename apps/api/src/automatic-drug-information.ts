import { z } from "zod";
import { pool } from "../../../db/client.js";
import {
  identityKey,
  drugCardSchema,
  type DrugIdentity,
  type DrugCard,
} from "../../../packages/domain/src/drug-information.js";
import {
  localDrugCard,
  type AutomaticInformation,
} from "../../../packages/domain/src/drug-uses.js";
import { searchCatalog } from "../../../packages/domain/src/drug-catalog.js";

type Resolution = {
  state: AutomaticInformation["state"];
  card: DrugCard | null;
  mapping_id?: string;
};
export async function resolveDrugAutomatically(
  m: DrugIdentity,
  fetcher: typeof fetch = fetch,
): Promise<Resolution> {
  const local = localDrugCard(m);
  if (local) return { state: "matched", card: drugCardSchema.parse(local) };
  if (m.productType === "supplement")
    return { state: "needs-review", card: null };
  const query = (m.generic?.trim() || m.brand?.trim() || m.name.trim()).slice(
    0,
    100,
  );
  if (query.length < 2 || /[+/&]|\band\b/i.test(query))
    return { state: "needs-review", card: null };
  const signal = AbortSignal.timeout(5000);
  async function json(url: URL) {
    const r = await fetcher(url, {
      signal,
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!r.ok || !r.headers.get("content-type")?.includes("application/json"))
      throw new Error("Unavailable");
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 131072) throw new Error("Oversized");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  try {
    const url = new URL("https://rxnav.nlm.nih.gov/REST/rxcui.json");
    url.searchParams.set("name", query);
    url.searchParams.set("search", "0");
    const match = z
      .object({
        idGroup: z.object({
          rxnormId: z
            .array(z.string().regex(/^\d{1,12}$/))
            .max(20)
            .optional(),
        }),
      })
      .parse(await json(url));
    const ids = [...new Set(match.idGroup.rxnormId || [])];
    if (!ids.length) return { state: "not-found", card: null };
    if (ids.length !== 1) return { state: "needs-review", card: null };
    const related = new URL(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${ids[0]}/related.json?tty=IN`,
    );
    const data = z
      .object({
        relatedGroup: z.object({
          conceptGroup: z
            .array(
              z.object({
                tty: z.string(),
                conceptProperties: z
                  .array(z.object({ name: z.string().max(300) }))
                  .max(30)
                  .optional(),
              }),
            )
            .max(20)
            .optional(),
        }),
      })
      .parse(await json(related));
    const names = [
      ...new Set(
        (data.relatedGroup.conceptGroup || [])
          .filter((g) => g.tty === "IN")
          .flatMap((g) =>
            (g.conceptProperties || []).map((c) => c.name.toLowerCase()),
          ),
      ),
    ];
    if (names.length !== 1) return { state: "needs-review", card: null };
    const card = searchCatalog(names[0])[0];
    return {
      state: card ? "matched" : "needs-review",
      card: card ? drugCardSchema.parse(card) : null,
      mapping_id: ids[0],
    };
  } catch {
    return { state: "unavailable", card: null };
  }
}

export async function refreshAutomaticMedicine(
  m: { id: string; patient_id: string; data: DrugIdentity },
  fetcher: typeof fetch = fetch,
) {
  const key = identityKey(m.data);
  const lease = await pool.query(
    "INSERT INTO medication_information_automatic(medication_id,patient_id,identity_key,state,retry_at) VALUES($1,$2,$3,'pending',now()+interval '2 minutes') ON CONFLICT(medication_id) DO UPDATE SET identity_key=excluded.identity_key,state='pending',card=NULL,retry_at=excluded.retry_at WHERE medication_information_automatic.identity_key<>excluded.identity_key OR medication_information_automatic.retry_at<=now() RETURNING medication_id",
    [m.id, m.patient_id, key],
  );
  if (!lease.rowCount) return;
  const result = await resolveDrugAutomatically(m.data, fetcher);
  const current = (
    await pool.query(
      "SELECT m.data FROM medications m JOIN patients p ON p.id=m.patient_id WHERE m.id=$1 AND m.patient_id=$2 AND m.deleted_at IS NULL AND p.deleted_at IS NULL",
      [m.id, m.patient_id],
    )
  ).rows[0];
  if (!current || identityKey(current.data) !== key) return;
  const seconds =
    result.state === "unavailable"
      ? 900
      : result.state === "matched"
        ? 86400
        : 604800;
  await pool.query(
    "UPDATE medication_information_automatic SET state=$3,card=$4,mapping_id=$5,checked_at=now(),retry_at=now()+($6*interval '1 second') WHERE medication_id=$1 AND identity_key=$2",
    [m.id, key, result.state, result.card, result.mapping_id || null, seconds],
  );
}
/** All work finishes before return; never competes with due reminder dispatch. */
export async function refreshAutomaticBatch() {
  const m = (
    await pool.query(
      "SELECT m.id,m.patient_id,m.data FROM medications m JOIN patients p ON p.id=m.patient_id LEFT JOIN medication_information_automatic a ON a.medication_id=m.id WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND coalesce((p.data->>'automaticDrugInformation')::boolean,true) AND (a.medication_id IS NULL OR a.retry_at<=now()) ORDER BY a.checked_at NULLS FIRST,m.id LIMIT 1",
    )
  ).rows[0];
  if (m) await refreshAutomaticMedicine(m);
}
