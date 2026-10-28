import { describe, it, expect, vi } from "vitest";
import {
  identityKey,
  safeDrugSource,
} from "../packages/domain/src/drug-information";
import { searchCatalog } from "../packages/domain/src/drug-catalog";
import {
  searchDrugInformation,
  getDrugInformation,
  labelCard,
} from "../apps/api/src/drug-information";

const setId = "c30b0735-4b82-4baa-8d7c-102a00128ef3";
const label = {
  set_id: setId,
  effective_time: "20261001",
  indications_and_usage: [
    "Used for a synthetic test condition. <script>not executable</script>",
  ],
  openfda: {
    generic_name: ["Synthetic ingredient"],
    brand_name: ["Synthetic brand"],
    route: ["ORAL"],
    product_type: ["HUMAN PRESCRIPTION DRUG"],
  },
};
const reply = (results: unknown[]) =>
  new Response(JSON.stringify({ results }), {
    headers: { "content-type": "application/json" },
  });
describe("medicine information", () => {
  it("keeps valid labels when another provider record has an unusable ingredient", async () => {
    const invalid = {
      ...label,
      openfda: { ...label.openfda, generic_name: [""] },
    };
    const htmlOnly = {
      ...label,
      openfda: { ...label.openfda, generic_name: ["<span></span>"] },
    };
    const fetcher = vi.fn(async () =>
      reply([invalid, htmlOnly, label]),
    ) as unknown as typeof fetch;
    const result = await searchDrugInformation("synthetic", true, fetcher);
    expect(result.provider).toBe("available");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].id).toBe("label:" + setId);
    expect(() => labelCard(invalid)).not.toThrow();
    expect(labelCard(invalid)).toBeUndefined();
  });
  it("matches exact Thai/English ingredient aliases without guessing brands/combinations", () => {
    expect(searchCatalog("  METFORMIN  ")[0].scope).toBe("ingredient");
    expect(searchCatalog("เมตฟอร์มิน")[0].id).toBe("catalog:metformin");
    expect(searchCatalog("acetaminophen")[0].id).toBe("catalog:paracetamol");
    for (const q of [
      "metfor",
      "unknown brand",
      "metformin + other",
      "metformin XR",
    ])
      expect(searchCatalog(q)).toEqual([]);
  });
  it("fingerprints identity but excludes prescribing purpose and personal information", () => {
    const m = { name: "A", generic: "G", strength: "5 mg", form: "tablet" };
    expect(identityKey({ ...m, purpose: "private" } as typeof m)).toBe(
      identityKey(m),
    );
    expect(identityKey({ ...m, strength: "10 mg" })).not.toBe(identityKey(m));
    expect(identityKey({ ...m, form: "drops" })).not.toBe(identityKey(m));
  });
  it("uses local summaries without a network request", async () => {
    const fetcher = vi.fn();
    const r = await searchDrugInformation("metformin", false, fetcher);
    expect(r.cards[0].uses.th).toContain("เบาหวาน");
    expect(r.cards[0].review).toBe("source-summary-not-clinically-reviewed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("performs a real provider contract lookup with only query text and no cookies/redirects", async () => {
    const fetcher = vi.fn(async () =>
      reply([label]),
    ) as unknown as typeof fetch;
    const r = await searchDrugInformation("synthetic", true, fetcher);
    expect(r.provider).toBe("available");
    expect(r.cards[0].id).toBe("label:" + setId);
    const [url, options] = (fetcher as any).mock.calls[0];
    expect(url.origin).toBe("https://api.fda.gov");
    expect([...url.searchParams.keys()]).toEqual(["search", "limit"]);
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(r.cards[0].uses.th).toBeUndefined();
    expect(r.cards[0].uses.en).not.toContain("<script>");
    expect(r.cards[0].sourceDate).toBe("2026-10-01");
  });
  it("quotes query syntax rather than permitting arbitrary search operators", async () => {
    const fetcher = vi.fn(async () => reply([])) as unknown as typeof fetch;
    await searchDrugInformation('x" OR *:*', true, fetcher);
    const search = (fetcher as any).mock.calls[0][0].searchParams.get("search");
    expect(search).not.toContain("*:");
  });
  it("degrades on provider failures without losing local cards", async () => {
    for (const status of [429, 500]) {
      const r = await searchDrugInformation(
        "metformin",
        true,
        async () => new Response("", { status }),
      );
      expect(r.provider).toBe("unavailable");
      expect(r.cards[0].id).toBe("catalog:metformin");
    }
    expect(
      (
        await searchDrugInformation(
          "unknown",
          true,
          async () => new Response("", { status: 404 }),
        )
      ).cards,
    ).toEqual([]);
  });
  it("rejects malformed/oversized/provider HTML and nonhuman labels", async () => {
    expect(
      labelCard({
        ...label,
        openfda: { ...label.openfda, product_type: ["OTC ANIMAL DRUG"] },
      }),
    ).toBeUndefined();
    expect(labelCard({ set_id: "https://evil.invalid" })).toBeUndefined();
    for (const r of [
      new Response("{}", { headers: { "content-type": "text/html" } }),
      new Response("x".repeat(1048577), {
        headers: { "content-type": "application/json" },
      }),
      new Response('{"results":"bad"}', {
        headers: { "content-type": "application/json" },
      }),
    ]) {
      expect(
        (await searchDrugInformation("unknown", true, async () => r)).provider,
      ).toBe("unavailable");
    }
  });
  it("only accepts built-in source hosts and validated IDs", async () => {
    for (const raw of [
      "javascript:alert(1)",
      "https://www.nhs.uk.evil.invalid/",
      "https://user@www.nhs.uk/",
      "http://www.nhs.uk/",
      "https://www.nhs.uk:444/",
    ])
      expect(safeDrugSource(raw)).toBe(false);
    expect(safeDrugSource("https://www.nhs.uk/medicines/metformin/")).toBe(
      true,
    );
    const fetcher = vi.fn();
    expect(
      await getDrugInformation("https://127.0.0.1", fetcher),
    ).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retrieves a confirmed label using its exact hyphenated SET ID", async () => {
    const fetcher = vi.fn(async () =>
      reply([label]),
    ) as unknown as typeof fetch;
    const card = await getDrugInformation("label:" + setId, fetcher);
    expect(card?.id).toBe("label:" + setId);
    expect((fetcher as any).mock.calls[0][0].searchParams.get("search")).toBe(
      `set_id:"${setId}"`,
    );
    expect(
      labelCard({
        ...label,
        indications_and_usage: [],
        purpose: ["Synthetic purpose"],
      })?.uses.en,
    ).toBe("Synthetic purpose");
  });
});
