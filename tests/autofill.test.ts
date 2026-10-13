import { describe, expect, it } from "vitest";
import {
  formForUnit,
  mealOf,
  mealTime,
  readLabel,
} from "../apps/web/src/autofill";

describe("label autofill", () => {
  it("reads common Thai pharmacy labels", () => {
    expect(
      readLabel("รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง หลังอาหาร เช้า เย็น"),
    ).toEqual({
      amount: "1",
      unit: "เม็ด",
      meals: ["morning", "evening"],
      food: "หลังอาหาร",
      route: "รับประทาน",
    });
    expect(
      readLabel("รับประทานครั้งละครึ่งเม็ด ก่อนอาหารเช้า 30 นาที"),
    ).toMatchObject({
      amount: "1/2",
      unit: "เม็ด",
      meals: ["morning"],
      food: "ก่อนอาหาร 30 นาที",
    });
    expect(readLabel("รับประทานครั้งละ 1 เม็ด ก่อนนอน")).toMatchObject({
      meals: ["bedtime"],
    });
    expect(readLabel("ครั้งละ 5 มล. วันละ 3 ครั้ง หลังอาหาร")).toMatchObject({
      amount: "5",
      unit: "มล.",
      meals: ["morning", "noon", "evening"],
    });
    expect(readLabel("หยอดตาครั้งละ 1 หยด วันละ 4 ครั้ง")).toMatchObject({
      amount: "1",
      unit: "หยด",
      route: "หยอดตา",
      meals: ["morning", "noon", "evening", "bedtime"],
    });
  });
  it("marks as-needed medicines and never picks a number from a range", () => {
    const prn = readLabel(
      "รับประทานครั้งละ 1-2 เม็ด เมื่อมีอาการปวด ทุก 4-6 ชั่วโมง",
    );
    expect(prn.asNeeded).toBe(true);
    expect(prn.amount).toBeUndefined();
    expect(prn.unit).toBe("เม็ด");
    expect(prn.interval).toBe("ทุก 4-6 ชั่วโมง");
  });
  it("reads simple English labels", () => {
    expect(
      readLabel("Take 1 tablet twice... 2 times a day after meals"),
    ).toMatchObject({
      amount: "1",
      unit: "tablet",
      meals: ["morning", "evening"],
      food: "After meals",
    });
    expect(readLabel("Take one capsule at bedtime")).toMatchObject({
      amount: "1",
      unit: "capsule",
      meals: ["bedtime"],
    });
  });
  it("returns nothing for empty or unrelated text", () => {
    expect(readLabel("")).toEqual({});
    expect(readLabel("Amlodipine 5 mg")).toEqual({});
  });
  it("maps meal times and units to clock times, form and route", () => {
    expect(mealTime("morning")).toBe("08:00");
    expect(mealTime("morning", "ก่อนอาหาร 30 นาที")).toBe("07:30");
    expect(mealTime("bedtime", "ก่อนอาหาร")).toBe("21:00");
    expect(mealOf("18:00")).toBe("evening");
    expect(mealOf("17:30")).toBe("evening");
    expect(mealOf("10:15")).toBeUndefined();
    expect(formForUnit("แคปซูล").form).toBe("capsule");
    expect(formForUnit("มล.").form).toBe("liquid");
    expect(formForUnit("หยด").route.th).toBe("หยอด");
    expect(formForUnit("เม็ด").route.th).toBe("รับประทาน");
  });
});
