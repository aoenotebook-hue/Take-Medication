import { describe, expect, it } from "vitest";
import { describe as describeMedicine } from "../apps/web/src/pdf";

const row = (data: any, medicine: any = {}) => ({
  medicine: {
    id: "m1",
    data: {
      name: "Synthetic",
      strength: "5 mg",
      generic: "",
      brand: "",
      form: "tablet",
      route: "",
      purpose: "",
      productType: "prescription",
      source: "",
      ...medicine,
    },
  },
  current: { effective_at: "2026-01-01T00:00:00Z", data },
  future: [] as any[],
});
describe("doctor summary content", () => {
  it("keeps weekdays, per-time amounts and a non-Bangkok timezone", () => {
    const it = describeMedicine(
      row({
        status: "active",
        route: "รับประทาน",
        food: "หลังอาหาร",
        timezone: "Asia/Tokyo",
        start: "2026-01-01",
        slots: [
          {
            id: "a",
            time: "08:00",
            amount: "1",
            unit: "เม็ด",
            weekdays: [1, 3, 5],
          },
          {
            id: "b",
            time: "21:00",
            amount: "1/2",
            unit: "เม็ด",
            weekdays: [1, 3, 5],
          },
        ],
      }),
      "th",
      "Asia/Bangkok",
    );
    expect(it.times).toContain("จ. พ. ศ.");
    expect(it.times).toContain("(1 เม็ด)");
    expect(it.times).toContain("(1/2 เม็ด)");
    expect(it.times).toContain("Asia/Tokyo");
  });
  it("shows the as-needed dose and supplied limits without calculating anything", () => {
    const it = describeMedicine(
      row({
        status: "as-needed",
        route: "รับประทาน",
        prnAmount: "1",
        prnUnit: "เม็ด",
        prnIndication: "เมื่อปวด",
        prnInterval: "ทุก 4-6 ชั่วโมง",
        prnMaximum: "4 เม็ด/วัน",
        slots: [],
      }),
      "th",
      "Asia/Bangkok",
    );
    expect(it.how).toContain("ครั้งละ 1 เม็ด");
    expect(it.how).toContain("เมื่อปวด");
    expect(it.how).toContain("ทุก 4-6 ชั่วโมง");
    expect(it.how).toContain("4 เม็ด/วัน");
  });
  it("flags draft records as incomplete", () => {
    const it = describeMedicine(
      row({ status: "draft", slots: [] }),
      "en",
      "Asia/Bangkok",
    );
    expect(it.flags.join(" ")).toContain("Incomplete");
  });
});
