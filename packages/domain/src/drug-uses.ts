import { searchCatalog } from "./drug-catalog.js";
import {
  identityKey,
  type DrugIdentity,
  type DrugCard,
} from "./drug-information.js";
export type AutomaticInformation = {
  medication_id: string;
  identity_key: string;
  state: "matched" | "needs-review" | "not-found" | "unavailable" | "pending";
  card: DrugCard | null;
  retry_at: string;
};
/** Never split combinations or infer a brand from a similar spelling. */
export function localDrugCard(m: DrugIdentity): DrugCard | undefined {
  if (m.productType === "supplement") return;
  const query = m.generic?.trim() || m.name.trim();
  return searchCatalog(query).find(
    (c) => Date.parse(c.validUntil) > Date.now(),
  );
}
export function drugUse(
  m: DrugIdentity & { purpose?: string },
  automatic: AutomaticInformation | undefined,
  lang: "th" | "en",
) {
  const local = localDrugCard(m);
  const card =
    local ||
    (automatic?.identity_key === identityKey(m) && automatic.state === "matched"
      ? automatic.card
      : undefined);
  if (card && Date.parse(card.validUntil) > Date.now() && card.shortUses)
    return { text: card.shortUses[lang], kind: "general" as const };
  if (m.purpose?.trim())
    return { text: m.purpose.trim().slice(0, 80), kind: "recorded" as const };
  return undefined;
}
