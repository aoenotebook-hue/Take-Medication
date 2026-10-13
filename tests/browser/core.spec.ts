import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("Thai navigation, offline cold open, privacy clearing and accessibility", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await expect(
    page.getByRole("heading", { name: "วันนี้", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "แสดงให้แพทย์ดู", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "แสดงให้แพทย์ดู", exact: true }),
  ).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("ผู้ป่วยตัวอย่าง / Demo patient").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "ยาของฉัน", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ยาของฉัน", exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "การตั้งค่า", exact: true }).click();
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const request = indexedDB.open("medication-private");
      return new Promise<number>((resolve) => {
        request.onsuccess = () => {
          const tx = request.result.transaction("snapshots");
          const r = tx.objectStore("snapshots").count();
          r.onsuccess = () => resolve(r.result);
        };
      });
    }),
  ).toBe(0);
});
test("guided manual draft without photos and 200% layout", async ({
  page,
  context,
}) => {
  const name = "Synthetic browser " + Date.now();
  const batches: any[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/sync/push"))
      batches.push(r.postDataJSON().operations);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "ยาของฉัน", exact: true }).click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("ชื่อยา", { exact: true }).fill(name);
  await page.getByLabel("ความแรง / ข้อความบนฉลาก").fill("5 mg + 10 mg");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("วิธีใช้ยา", { exact: true }).fill("oral");
  await page.getByLabel("คำแนะนำเดิม").fill("Synthetic original instructions");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("สถานะ", { exact: true }).selectOption("draft");
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(
    page.getByText(
      "การเปลี่ยนแปลงบันทึกในโทรศัพท์นี้ การแจ้งเตือนจากเซิร์ฟเวอร์อาจยังใช้ตารางเดิมจนกว่าจะเชื่อมต่ออีกครั้ง",
      { exact: false },
    ),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "ลองซิงค์อีกครั้ง" }).click();
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }),
  ).toBeVisible();
  expect(
    batches.some(
      (b) =>
        b.length === 2 && b[0].kind === "medication" && b[1].kind === "regimen",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "แสดงให้แพทย์ดู", exact: true })
    .click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก PDF" }).click();
  const download = await downloadPromise;
  await download.saveAs("test-results/offline-summary.pdf");
  await context.setOffline(false);
  await page.evaluate(() => (document.documentElement.style.fontSize = "40px"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
