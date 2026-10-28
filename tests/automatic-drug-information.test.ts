import { describe, it, expect, vi } from "vitest";
import { resolveDrugAutomatically } from "../apps/api/src/automatic-drug-information";
import { drugUse } from "../packages/domain/src/drug-uses";
import { identityKey } from "../packages/domain/src/drug-information";
import { drugCatalog } from "../packages/domain/src/drug-catalog";
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const brand = {
  name: "Synthetic brand",
  brand: "Synthetic brand",
  generic: "",
  productType: "prescription",
};
describe("automatic drug lookup", () => {
  it("resolves known generic and Thai names offline without an external call", async () => {
    const fetcher = vi.fn();
    const r = await resolveDrugAutomatically({ name: "เมตฟอร์มิน" }, fetcher);
    expect(r.state).toBe("matched");
    expect(r.card?.shortUses?.en).toBe("Lowers blood sugar");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses exact RxNorm matching and only one verified ingredient", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () =>
        json({ idGroup: { rxnormId: ["123"] } }),
      )
      .mockImplementationOnce(async () =>
        json({
          relatedGroup: {
            conceptGroup: [
              { tty: "IN", conceptProperties: [{ name: "amlodipine" }] },
            ],
          },
        }),
      );
    const r = await resolveDrugAutomatically(
      { ...brand, purpose: "private diagnosis" } as typeof brand,
      fetcher,
    );
    expect(r.card?.shortUses?.en).toBe("Lowers blood pressure");
    const [url, options] = fetcher.mock.calls[0];
    expect(url.hostname).toBe("rxnav.nlm.nih.gov");
    expect(url.searchParams.get("search")).toBe("0");
    expect(url.searchParams.get("name")).toBe("Synthetic brand");
    expect(url.toString()).not.toContain("private");
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
  });
  it("leaves ambiguous and combination medicines for review", async () => {
    const ambiguous = await resolveDrugAutomatically(brand, async () =>
      json({ idGroup: { rxnormId: ["1", "2"] } }),
    );
    expect(ambiguous.state).toBe("needs-review");
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () =>
        json({ idGroup: { rxnormId: ["1"] } }),
      )
      .mockImplementationOnce(async () =>
        json({
          relatedGroup: {
            conceptGroup: [
              {
                tty: "IN",
                conceptProperties: [
                  { name: "amlodipine" },
                  { name: "atorvastatin" },
                ],
              },
            ],
          },
        }),
      );
    expect((await resolveDrugAutomatically(brand, fetcher)).state).toBe(
      "needs-review",
    );
    const unused = vi.fn();
    expect(
      (await resolveDrugAutomatically({ name: "metformin + other" }, unused))
        .card,
    ).toBeNull();
    expect(unused).not.toHaveBeenCalled();
  });
  it("handles no match, unsupported supplements and outages without inventing uses", async () => {
    expect(
      (await resolveDrugAutomatically(brand, async () => json({ idGroup: {} })))
        .state,
    ).toBe("not-found");
    expect(
      (await resolveDrugAutomatically({ ...brand, productType: "supplement" }))
        .state,
    ).toBe("needs-review");
    expect(
      (
        await resolveDrugAutomatically(
          brand,
          async () => new Response("", { status: 503 }),
        )
      ).state,
    ).toBe("unavailable");
  });
  it("does not use a stale identity or expired card in list/push summaries", () => {
    const m = { ...brand, strength: "5 mg" };
    const info = {
      medication_id: "m",
      identity_key: identityKey(m),
      state: "matched" as const,
      card: drugCatalog.find((c) => c.name === "amlodipine")!,
      retry_at: new Date().toISOString(),
    };
    expect(drugUse(m, info, "en")?.text).toBe("Lowers blood pressure");
    expect(drugUse({ ...m, strength: "10 mg" }, info, "en")).toBeUndefined();
    expect(
      drugUse(
        m,
        { ...info, card: { ...info.card, validUntil: "2000-01-01T00:00:00Z" } },
        "en",
      ),
    ).toBeUndefined();
    expect(
      drugUse({ ...m, purpose: "My recorded reason" }, undefined, "en")?.kind,
    ).toBe("recorded");
  });
});
