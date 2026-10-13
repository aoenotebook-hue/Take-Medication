import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
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
test("large camera photo is compressed offline and uploaded within the hosting limit", async ({
  page,
  context,
}) => {
  const photo = await sharp(randomBytes(1700 * 1500 * 3), {
    raw: { width: 1700, height: 1500, channels: 3 },
  })
    .png()
    .toBuffer();
  expect(photo.length).toBeGreaterThan(2 * 1024 * 1024);
  expect(photo.length).toBeLessThan(8 * 1024 * 1024);
  await page.goto("/");
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "ยาของฉัน", exact: true }).click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "synthetic-camera.png",
      mimeType: "image/png",
      buffer: photo,
    });
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page
    .getByLabel("ชื่อยา", { exact: true })
    .fill("Synthetic photo " + Date.now());
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByLabel("วิธีใช้ยา", { exact: true }).fill("oral");
  await page.getByLabel("คำแนะนำเดิม").fill("Synthetic original instructions");
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const saved = await page.evaluate(
    async () =>
      new Promise<any>((resolve, reject) => {
        const open = indexedDB.open("medication-private");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result
            .transaction("photos")
            .objectStore("photos")
            .getAll();
          get.onsuccess = () =>
            resolve(
              get.result
                .filter((p: any) => p.pending)
                .map((p: any) => ({ size: p.blob.size, type: p.blob.type })),
            );
        };
      }),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].type).toBe("image/jpeg");
  expect(saved[0].size).toBeLessThanOrEqual(2 * 1024 * 1024);
  const uploaded = page.waitForResponse(
    (r) =>
      r.url().includes("/photos?medicationId=") &&
      r.request().method() === "POST",
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "ลองซิงค์อีกครั้ง" }).click();
  expect((await uploaded).status()).toBe(200);
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }),
  ).toBeVisible();
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
