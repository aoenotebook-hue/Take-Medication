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
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "synthetic-camera.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await page
    .getByLabel("ชื่อยา", { exact: true })
    .fill("Synthetic photo " + Date.now());
  await page
    .getByLabel("ข้อความบนฉลากยา (ถ้ามี)")
    .fill("Synthetic original instructions");
  await page.getByRole("button", { name: /บันทึกเป็นแบบร่าง/ }).click();
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
  await page.getByLabel("ชื่อยา", { exact: true }).fill(name);
  await page.getByLabel("ความแรง (ถ้ามี)").fill("5 mg + 10 mg");
  await page
    .getByLabel("ข้อความบนฉลากยา (ถ้ามี)")
    .fill("Synthetic original instructions");
  await page.getByRole("button", { name: /บันทึกเป็นแบบร่าง/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("สถานะ", { exact: true }).selectOption("draft");
  await expect(page.locator(".med-row", { hasText: name })).toBeVisible();
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
  await page.getByRole("button", { name: /ส่งหรือพิมพ์ PDF/ }).click();
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
test("one-page entry fills chips from label wording and saves an active medicine", async ({
  page,
}) => {
  const name = "Synthetic label " + Date.now();
  await page.goto("/");
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "ยาของฉัน", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  await page.getByLabel("ชื่อยา", { exact: true }).fill(name);
  await page
    .getByLabel("ข้อความบนฉลากยา (ถ้ามี)")
    .fill("รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง หลังอาหาร เช้า เย็น");
  await page.getByLabel("ความแรง (ถ้ามี)").focus();
  const dialog = page.getByRole("dialog");
  for (const chip of ["1", "เม็ด", "เช้า", "เย็น", "หลังอาหาร", "ทุกวัน"])
    await expect(
      dialog.getByRole("button", { name: chip, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText(/เติมให้จากฉลาก/)).toBeVisible();
  // Saving without the confirmation tick explains what is missing.
  await dialog.getByRole("button", { name: /^✓ บันทึก$/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("ติ๊กยืนยัน");
  await dialog.getByLabel("ข้อมูลนี้ตรงกับใบสั่งยา").check();
  await dialog.getByRole("button", { name: /^✓ บันทึก$/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "ลองซิงค์อีกครั้ง" }).click();
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }),
  ).toBeVisible();
  const card = page.locator("article", { hasText: name });
  await expect(
    card.getByText(/เช้า 08:00 · เย็น 18:00 · ทุกวัน/),
  ).toBeVisible();
  await expect(card.getByText(/ครั้งละ 1 เม็ด · หลังอาหาร/)).toBeVisible();
  // Editing keeps the one-page form filled and records a reason automatically.
  await card.getByRole("button", { name: /เปิดข้อมูลยา/ }).click();
  await page.getByRole("button", { name: /แก้ไขวิธีใช้/ }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel("ชื่อยา", { exact: true })).toHaveValue(name);
  await edit.getByRole("button", { name: "กลางวัน", exact: true }).click();
  await edit.getByLabel("ข้อมูลนี้ตรงกับใบสั่งยา").check();
  await edit.getByRole("button", { name: /^✓ บันทึก$/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "ลองซิงค์อีกครั้ง" }).click();
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }),
  ).toBeVisible();
  await expect(card.getByText(/กลางวัน 12:00/)).toBeVisible();
});
test("row edit and delete buttons, daily schedule view, and clear all data", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  const stamp = Date.now();
  await page.goto("/");
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "ยาของฉัน", exact: true }).click();
  for (const [name, meal] of [
    ["Synthetic keep " + stamp, "เช้า"],
    ["Synthetic mistake " + stamp, "ก่อนนอน"],
  ]) {
    await page.getByRole("button", { name: "เพิ่มยา" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("ชื่อยา", { exact: true }).fill(name);
    await form.getByRole("button", { name: "1", exact: true }).click();
    await form.getByRole("button", { name: "เม็ด", exact: true }).click();
    await form.getByRole("button", { name: meal, exact: true }).click();
    await form.getByLabel("ข้อมูลนี้ตรงกับใบสั่งยา").check();
    await form.getByRole("button", { name: /^✓ บันทึก$/ }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page.getByRole("button", { name: "ลองซิงค์อีกครั้ง" }).click();
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }),
  ).toBeVisible();
  // Daily schedule groups medicines by clock time.
  await page.getByRole("button", { name: "ตารางเวลาแต่ละวัน" }).click();
  await expect(
    page.getByRole("heading", { name: /08:00 · เช้า/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /21:00 · ก่อนนอน/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ตามยา", exact: true }).click();
  // Delete the one added by mistake.
  await page
    .getByRole("button", { name: "ลบ Synthetic mistake " + stamp })
    .click();
  const rowOf = (text: string) => page.locator(".med-row", { hasText: text });
  await expect(rowOf("Synthetic mistake " + stamp)).toHaveCount(0);
  await expect(rowOf("Synthetic keep " + stamp)).toBeVisible();
  // The edit button on the row opens the filled form directly.
  await page
    .getByRole("button", { name: "แก้ไข Synthetic keep " + stamp })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("ชื่อยา", { exact: true }),
  ).toHaveValue("Synthetic keep " + stamp);
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  // Clear all data removes everything but keeps the profile name and sign-in.
  await page.getByRole("button", { name: "การตั้งค่า", exact: true }).click();
  await page.getByRole("button", { name: /ล้างข้อมูลทั้งหมด/ }).click();
  await expect(page.getByText(/ล้างข้อมูลทั้งหมดแล้ว/)).toBeVisible();
  await expect(rowOf("Synthetic keep " + stamp)).toHaveCount(0);
  await expect(page.getByText("ยังไม่มีรายการยา").first()).toBeVisible();
  await expect(
    page.getByText("ผู้ป่วยตัวอย่าง / Demo patient").first(),
  ).toBeVisible();
});
