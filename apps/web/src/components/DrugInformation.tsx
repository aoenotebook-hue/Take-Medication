import React, { useEffect, useRef, useState } from "react";
import { db } from "../storage";
import { searchCatalog } from "../../../../packages/domain/src/drug-catalog";
import {
  drugCardSchema,
  identityKey,
  safeDrugSource,
  type DrugCard,
  type DrugIdentity,
  type DrugSearch,
} from "../../../../packages/domain/src/drug-information";

type Props = {
  actor: string;
  patientId: string;
  medicine: { id: string; data: DrugIdentity & { purpose?: string } };
  lang: "th" | "en";
  readonly: boolean;
  isCurrent: () => boolean;
  request: (
    path: string,
    body?: unknown,
    method?: string,
    signal?: AbortSignal,
  ) => Promise<any>;
};
export function DrugInformation({
  actor,
  patientId,
  medicine,
  lang,
  readonly,
  isCurrent,
  request,
}: Props) {
  const t = (th: string, en: string) => (lang === "th" ? th : en);
  const fingerprint = identityKey(medicine.data);
  const cacheKey = "drug-info:" + actor + ":" + patientId + ":" + medicine.id;
  const path =
    "/patients/" + patientId + "/medications/" + medicine.id + "/information";
  const [query, setQuery] = useState(
    (medicine.data.generic || medicine.data.name).slice(0, 100),
  );
  const [cards, setCards] = useState<DrugCard[]>([]),
    [selected, setSelected] = useState<DrugCard>();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true),
    sequence = useRef(0),
    running = useRef(false);
  const currentRef = useRef(isCurrent);
  currentRef.current = isCurrent;
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
      controller.current?.abort();
    };
  }, []);
  const valid = (n: number) =>
    alive.current && sequence.current === n && currentRef.current();
  async function cache(card: DrugCard, n: number) {
    await db.transaction("rw", db.meta, async () => {
      const who = (await db.meta.get("actor"))?.value;
      if (valid(n) && who === actor)
        await db.meta.put({
          key: cacheKey,
          value: { identityKey: fingerprint, card },
        });
    });
  }
  async function run(work: (signal: AbortSignal, n: number) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const n = ++sequence.current;
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 12000);
    try {
      await work(controller.current.signal, n);
    } catch (e) {
      if (valid(n)) {
        if ((e as { status?: number }).status === 403) {
          setSelected(undefined);
          setCards([]);
          await db.meta.delete(cacheKey);
        }
        setMessage(
          t(
            "เชื่อมต่อแหล่งข้อมูลไม่ได้ ลองอีกครั้ง หรือใช้ข้อมูลที่เก็บไว้",
            "Information unavailable. Retry or use previously saved information.",
          ),
        );
      }
    } finally {
      clearTimeout(timer);
      running.current = false;
      if (valid(n)) setBusy(false);
    }
  }
  async function load() {
    await run(async (signal, n) => {
      const cached = await db.meta.get(cacheKey);
      if (valid(n) && cached?.value.identityKey === fingerprint) {
        const card = drugCardSchema.safeParse(cached.value.card);
        if (card.success && safeDrugSource(card.data.sourceUrl))
          setSelected(card.data);
      }
      const r = await request(path, undefined, "GET", signal);
      if (!valid(n)) return;
      if (r.identityKey !== fingerprint || r.state === "needs-review") {
        setSelected(undefined);
        setMessage(
          t(
            "ชื่อหรือรูปแบบยาเปลี่ยน กรุณาค้นหาและตรวจสอบใหม่",
            "Medicine identity changed. Search and compare again.",
          ),
        );
        return;
      }
      if (r.card) {
        const card = drugCardSchema.parse(r.card);
        if (!safeDrugSource(card.sourceUrl)) return;
        setSelected(card);
        setConfirmed(true);
        await cache(card, n);
      } else {
        setSelected(undefined);
        await db.meta.delete(cacheKey);
      }
    });
  }
  async function search(remote: boolean) {
    if (query.trim().length < 2) return;
    setSelected(undefined);
    setConfirmed(false);
    const local =
      medicine.data.productType === "supplement" ? [] : searchCatalog(query);
    setCards(local);
    if (!remote) {
      setMessage(
        local.length
          ? t(
              "เปรียบเทียบชื่อสารสำคัญกับฉลากก่อนอ่าน",
              "Compare the ingredient with your label before reading.",
            )
          : t(
              "ไม่พบในข้อมูลสรุป 7 รายการ ลองชื่อสามัญ หรือค้นหาฉลากภาษาอังกฤษ",
              "No match in the seven-ingredient summary catalog. Try the generic name or search English labels.",
            ),
      );
      return;
    }
    await run(async (signal, n) => {
      const r: DrugSearch = await request(
        path + "/search",
        { query: query.trim(), remote: true },
        "POST",
        signal,
      );
      if (!valid(n)) return;
      setCards(
        r.cards
          .map((c) => drugCardSchema.parse(c))
          .filter((c) => safeDrugSource(c.sourceUrl)),
      );
      setMessage(
        r.provider === "unavailable"
          ? t(
              "แหล่งข้อมูลภายนอกยังไม่พร้อม ข้อมูลสรุปในแอปยังเปิดได้",
              "External source unavailable. In-app summaries remain available.",
            )
          : !r.cards.length
            ? t(
                "ยังระบุยาไม่ได้ กรุณาตรวจฉลากหรือสอบถามเภสัชกร",
                "No reliable result. Check your label or ask a pharmacist.",
              )
            : t(
                "ผลค้นหาอาจไม่ใช่ผลิตภัณฑ์ของคุณ กรุณาเปรียบเทียบฉลาก",
                "Results may describe a different product. Compare your label.",
              ),
      );
    });
  }
  async function save() {
    if (!selected || !confirmed || readonly) return;
    await run(async (signal, n) => {
      const r = await request(
        path + "/match",
        { id: selected.id, identityKey: fingerprint, confirmed: true },
        "POST",
        signal,
      );
      if (!valid(n)) return;
      const card = drugCardSchema.parse(r.card);
      if (r.identityKey !== fingerprint || !safeDrugSource(card.sourceUrl))
        return;
      await cache(card, n);
      if (valid(n))
        setMessage(
          t(
            "บันทึกแหล่งข้อมูลแล้ว วิธีใช้ยาเดิมไม่เปลี่ยน",
            "Information saved. Your medicine instructions are unchanged.",
          ),
        );
    });
  }
  const stale = selected && Date.parse(selected.validUntil) <= Date.now();
  return (
    <details
      className="drug-information"
      onToggle={(e) => {
        if (e.currentTarget.open && !selected && !busy) void load();
      }}
    >
      <summary>
        {t("ยานี้ใช้เพื่ออะไร", "What is this medicine used for?")}
      </summary>
      <section aria-label={t("ข้อมูลยา", "Medicine information")}>
        <p>
          <strong>
            {t("เหตุผลที่บันทึกไว้สำหรับฉัน", "My recorded prescribing reason")}
          </strong>
          <br />
          {medicine.data.purpose ||
            t(
              "ยังไม่ได้บันทึก สอบถามแพทย์หรือเภสัชกร",
              "Not recorded. Ask your doctor or pharmacist.",
            )}
        </p>
        <p className="muted">
          {t(
            "ข้อมูลทั่วไปอาจไม่ตรงกับเหตุผลที่แพทย์สั่งให้คุณ อย่าเปลี่ยนวิธีใช้ยาจากผลค้นหา",
            "General uses may differ from your prescribing reason. Do not change your instructions based on a search.",
          )}
        </p>
        <label>
          {t("ค้นหาชื่อสามัญหรือยี่ห้อ", "Search generic or brand name")}
          <input
            type="search"
            value={query}
            maxLength={100}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setCards([]);
              setSelected(undefined);
              setConfirmed(false);
              setMessage("");
            }}
          />
        </label>
        {medicine.data.productType === "supplement" ? (
          <p role="status">
            {t(
              "ยังไม่มีข้อมูลที่ยืนยันสำหรับผลิตภัณฑ์เสริมอาหารนี้ โปรดสอบถามเภสัชกร",
              "No verified medicine information for this supplement. Ask a pharmacist.",
            )}
          </p>
        ) : (
          <div className="actions">
            <button
              type="button"
              disabled={busy || query.trim().length < 2}
              onClick={() => void search(false)}
            >
              {t("ค้นหาข้อมูลสรุป", "Find summary")}
            </button>
            <button
              type="button"
              disabled={busy || query.trim().length < 2}
              onClick={() => void search(true)}
            >
              {t("ค้นหาฉลากภาษาอังกฤษ", "Search English labels")}
            </button>
          </div>
        )}
        <p className="muted">
          {t(
            "การค้นหาภายนอกส่งเฉพาะชื่อที่ค้นหา ไม่ส่งข้อมูลผู้ป่วย แหล่งข้อมูลสหรัฐฯ อาจไม่ครอบคลุมยาไทย",
            "External lookup sends only the search text, not patient details. US sources may not cover Thai products.",
          )}
        </p>
        {busy && (
          <p role="status">{t("กำลังค้นหาข้อมูล…", "Loading information…")}</p>
        )}
        <p role="status">{message}</p>
        {!selected &&
          cards.map((c) => (
            <article key={c.id}>
              <h3>{c.name}</h3>
              <p>{c.ingredients.join(" · ")}</p>
              <p>{c.description}</p>
              <p>
                {c.publisher} · {c.country} ·{" "}
                {c.scope === "ingredient"
                  ? t(
                      "ระดับสารสำคัญ ไม่ใช่การยืนยันผลิตภัณฑ์",
                      "Ingredient information, not a product confirmation",
                    )
                  : t("ฉลากผลิตภัณฑ์สหรัฐฯ", "US product label")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelected(c);
                  setConfirmed(false);
                  setMessage("");
                }}
              >
                {t(
                  "ดูข้อมูลนี้และเปรียบเทียบฉลาก",
                  "Read this information and compare label",
                )}
              </button>
            </article>
          ))}
        {selected && (
          <article>
            <h3>{selected.name}</h3>
            <p>{selected.ingredients.join(" · ")}</p>
            <p>{selected.description}</p>
            <p>
              {selected.scope === "ingredient"
                ? t(
                    "ข้อมูลสารสำคัญ ไม่ได้ยืนยันความแรง รูปแบบ หรือผลิตภัณฑ์ของคุณ",
                    "Ingredient education; your strength, form and exact product have not been confirmed.",
                  )
                : t(
                    "ข้อมูลจากฉลากสหรัฐฯ ไม่ได้ยืนยันว่าเป็นผลิตภัณฑ์ของคุณ",
                    "US label information; this is not confirmation of your exact product.",
                  )}
            </p>
            <h4>{t("โดยทั่วไปยานี้ใช้เพื่อ", "Common uses")}</h4>
            {stale ? (
              <p role="status">
                {t(
                  "ข้อมูลนี้ถึงกำหนดตรวจสอบใหม่ กรุณาค้นหาใหม่หรือเปิดแหล่งอ้างอิง",
                  "This information needs refreshing. Search again or open the source.",
                )}
              </p>
            ) : (
              <>
                {!selected.uses.th && lang === "th" && (
                  <p>
                    {t(
                      "แหล่งข้อมูลนี้มีเฉพาะภาษาอังกฤษ",
                      "This source is available in English only.",
                    )}
                  </p>
                )}
                <p
                  className="drug-source-text"
                  lang={lang === "th" && selected.uses.th ? "th" : "en"}
                >
                  {(lang === "th" && selected.uses.th) || selected.uses.en}
                </p>
              </>
            )}
            <p className="muted">
              {t(
                "สรุป/ข้อความจากแหล่งอ้างอิง ยังไม่ได้ผ่านการทบทวนทางคลินิกหรือภาษาไทยโดยผู้เชี่ยวชาญ",
                "Source-based summary/text; independent clinical and Thai-language review is pending.",
              )}
            </p>
            <p>
              {selected.publisher} · {selected.country}
              <br />
              {t("วันที่ต้นฉบับ", "Source date")}:{" "}
              {selected.sourceDate || t("ไม่ระบุ", "Not provided")}
              <br />
              {t("ตรวจแหล่งข้อมูลล่าสุด", "Source last checked")}:{" "}
              {selected.checkedAt.slice(0, 10)}
            </p>
            {safeDrugSource(selected.sourceUrl) && (
              <a
                href={selected.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {t(
                  "เปิดแหล่งอ้างอิง (ภาษาอังกฤษ)",
                  "Open original source (English)",
                )}
              </a>
            )}
            <p>
              <a
                href="https://drug.fda.moph.go.th/drug-information"
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {t(
                  "เอกสารยาสำหรับประชาชน — อย. ไทย",
                  "Thai FDA patient leaflets",
                )}
              </a>
            </p>
            {!readonly && !stale && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {t(
                    "ฉันเปรียบเทียบสารสำคัญกับฉลากแล้ว การเลือกนี้ไม่ยืนยันการวินิจฉัยหรือเปลี่ยนวิธีใช้ยา",
                    "I compared the ingredient with my label. This selection does not confirm a diagnosis or change my instructions.",
                  )}
                </label>
                <button
                  type="button"
                  disabled={busy || !confirmed}
                  onClick={() => void save()}
                >
                  {t("บันทึกแหล่งข้อมูลไว้", "Save information source")}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSelected(undefined);
                setConfirmed(false);
              }}
            >
              {t("กลับไปเลือกผลค้นหา", "Back to results")}
            </button>
          </article>
        )}
      </section>
    </details>
  );
}
