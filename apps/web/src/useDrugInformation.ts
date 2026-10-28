import { useEffect, useState } from "react";
import { db, type Snapshot } from "./storage";
import { identityKey } from "../../../packages/domain/src/drug-information";
import {
  localDrugCard,
  type AutomaticInformation,
} from "../../../packages/domain/src/drug-uses";

export function useDrugInformation(
  actor: string,
  patient: string,
  snapshot: Snapshot | undefined,
  request: (
    path: string,
    body?: any,
    method?: string,
    signal?: AbortSignal,
  ) => Promise<any>,
  scope: number,
) {
  const [extra, setExtra] = useState<Record<string, AutomaticInformation>>({});
  const stamp = snapshot?.serverAt;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const cacheKey = "automatic-info:" + actor + ":" + patient;
    setExtra({});
    if (!actor || !patient || !snapshot) return;
    const current = snapshot;
    void (async () => {
      const saved = await db.meta.get(cacheKey);
      let found: Record<string, AutomaticInformation> = {
        ...(saved?.value || {}),
      };
      for (const info of current.automaticInformation || [])
        found[info.medication_id] = info;
      if (!active) return;
      setExtra({ ...found });
      if (current.profile.data.automaticDrugInformation === false) return;
      const pending = current.medications
        .filter((m) => {
          const old = found[m.id];
          return (
            !localDrugCard(m.data) &&
            m.data.productType !== "supplement" &&
            (!old ||
              old.identity_key !== identityKey(m.data) ||
              Date.parse(old.retry_at) <= Date.now())
          );
        })
        .slice(0, 6);
      for (let i = 0; i < pending.length && active; i += 2) {
        try {
          const r = await request(
            "/patients/" + patient + "/drug-information/refresh",
            { medicationIds: pending.slice(i, i + 2).map((m) => m.id) },
            "POST",
            controller.signal,
          );
          if (!active) return;
          for (const info of r.automaticInformation)
            found[info.medication_id] = info;
          setExtra({ ...found });
          await db.transaction("rw", db.meta, async () => {
            if (active && (await db.meta.get("actor"))?.value === actor)
              await db.meta.put({ key: cacheKey, value: found });
          });
        } catch {
          break;
        }
      }
    })().catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [actor, patient, stamp, scope]);
  return extra;
}
