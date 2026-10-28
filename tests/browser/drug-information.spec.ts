import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { drugCatalog } from "../../packages/domain/src/drug-catalog";
const card = drugCatalog[0];
async function medicine(page: Page) {
  // Other browser scenarios deliberately reset the demo profile and create due
  // alerts. Keep this read-only education scenario independent of those alerts.
  await page.route("**/snapshot", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot, occurrences: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await expect(
    page.getByRole("heading", { name: "วันนี้", exact: true }),
  ).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem("demo-token"));
  const med = crypto.randomUUID(),
    name = "Synthetic education " + med.slice(0, 8);
  const profiles = await (
    await page.request.get("/api/patients", {
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  const profile = profiles[0].id;
  const operations = [
    {
      kind: "medication",
      baseVersion: 0,
      data: {
        name,
        generic: "metformin",
        brand: "",
        strength: "500 mg",
        form: "tablet",
        route: "oral",
        purpose: "Synthetic personal reason",
        productType: "prescription",
        source: "synthetic",
        verified: false,
      },
    },
    {
      kind: "regimen",
      baseVersion: 1,
      data: {
        status: "draft",
        instructions: "Synthetic instructions",
        food: "",
        route: "oral",
        timezone: "Asia/Bangkok",
        start: "2026-10-01",
        slots: [],
        confirmed: false,
        source: "synthetic",
        reason: "initial",
        effectiveAt: new Date().toISOString(),
        effectiveMode: "on-commit",
      },
    },
  ].map((o) => ({
    ...o,
    id: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    patientId: profile,
    resourceId: med,
    clientAt: new Date().toISOString(),
  }));
  const r = await page.request.post("/api/sync/push", {
    headers: { Authorization: "Bearer " + token },
    data: { operations },
  });
  expect(
    (await r.json()).results.every((r: any) => r.status === "acknowledged"),
  ).toBe(true);
  await page.getByRole("button", { name: "การตั้งค่า", exact: true }).click();
  await page.getByRole("button", { name: /ซิงค์ข้อมูลตอนนี้/ }).click();
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
  await page
    .getByRole("combobox", { name: "สถานะ", exact: true })
    .selectOption("all");
  await page
    .locator(".med-row", { hasText: name })
    .getByRole("button", { name: /เปิดข้อมูลยา/ })
    .click();
  await page.locator(".drug-information > summary").click();
  await expect(
    page.getByRole("button", { name: "ค้นหาข้อมูลสรุป", exact: true }),
  ).toBeEnabled();
  return { name, med };
}
test("Thai medicine uses remain separate from personal purpose and survive offline reopen", async ({
  page,
  context,
}) => {
  const { name } = await medicine(page);
  await page
    .getByRole("button", { name: "ค้นหาข้อมูลสรุป", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ดูข้อมูลนี้และเปรียบเทียบฉลาก", exact: true })
    .click();
  await expect(page.locator(".drug-source-text")).toContainText(
    "เบาหวานชนิดที่ 2",
  );
  await expect(page.locator(".drug-information")).toContainText(
    "Synthetic personal reason",
  );
  await expect(page.locator(".drug-information")).toContainText(
    "ไม่ได้ยืนยันความแรง",
  );
  await expect(
    page.getByRole("button", { name: "บันทึกแหล่งข้อมูลไว้", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /ฉันเปรียบเทียบสารสำคัญ/ }).check();
  await page
    .getByRole("button", { name: "บันทึกแหล่งข้อมูลไว้", exact: true })
    .click();
  await expect(
    page.getByText("บันทึกแหล่งข้อมูลแล้ว วิธีใช้ยาเดิมไม่เปลี่ยน", {
      exact: true,
    }),
  ).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  // A cold reopen exercises IndexedDB restoration, not retained React state.
  await page.reload();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
  await page
    .getByRole("combobox", { name: "สถานะ", exact: true })
    .selectOption("all");
  await page
    .locator(".med-row", { hasText: name })
    .getByRole("button", { name: /เปิดข้อมูลยา/ })
    .click();
  await page.locator(".drug-information > summary").click();
  await expect(page.locator(".drug-source-text")).toContainText(
    "เบาหวานชนิดที่ 2",
  );
  await page.screenshot({
    path: "test-results/drug-information-thai.png",
    fullPage: true,
  });
  await context.setOffline(false);
});
test("English-only label results and source failures have explicit recoverable states", async ({
  page,
}) => {
  await medicine(page);
  await page.route("**/information/search", async (route) =>
    route.fulfill({
      json: {
        cards: [
          {
            ...card,
            id: "label:c30b0735-4b82-4baa-8d7c-102a00128ef3",
            scope: "label",
            uses: { en: "Synthetic source indication." },
            publisher: "openFDA / DailyMed",
            country: "US",
          },
        ],
        provider: "available",
      },
    }),
  );
  await page
    .getByRole("button", { name: "ค้นหาฉลากภาษาอังกฤษ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ดูข้อมูลนี้และเปรียบเทียบฉลาก", exact: true })
    .click();
  await expect(
    page.getByText("แหล่งข้อมูลนี้มีเฉพาะภาษาอังกฤษ", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".drug-source-text")).toContainText(
    "Synthetic source indication.",
  );
  await page
    .getByRole("button", { name: "กลับไปเลือกผลค้นหา", exact: true })
    .click();
  await page.unroute("**/information/search");
  await page.route("**/information/search", async (route) =>
    route.fulfill({ json: { cards: [], provider: "unavailable" } }),
  );
  await page
    .getByRole("button", { name: "ค้นหาฉลากภาษาอังกฤษ", exact: true })
    .click();
  await expect(page.getByText(/แหล่งข้อมูลภายนอกยังไม่พร้อม/)).toBeVisible();
  await page
    .getByRole("button", { name: "ค้นหาข้อมูลสรุป", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "ดูข้อมูลนี้และเปรียบเทียบฉลาก",
      exact: true,
    }),
  ).toBeVisible();
});
test("closing a pending lookup cannot display its late response in the app", async ({
  page,
}) => {
  await medicine(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/information/search", async (route) => {
    await held;
    await route
      .fulfill({
        json: {
          cards: [{ ...card, name: "STALE RESPONSE" }],
          provider: "available",
        },
      })
      .catch(() => {});
  });
  await page
    .getByRole("button", { name: "ค้นหาฉลากภาษาอังกฤษ", exact: true })
    .click();
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("STALE RESPONSE", { exact: true })).toHaveCount(
    0,
  );
});
