import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
// Sync now lives on the Settings tab; come back to the tab the test was on.
async function syncNow(page: Page, back = "รายการยา") {
  await page.getByRole("button", { name: "การตั้งค่า", exact: true }).click();
  await page.getByRole("button", { name: /ซิงค์ข้อมูลตอนนี้/ }).click();
  await expect(
    page.getByText("เซิร์ฟเวอร์รับข้อมูลทั้งหมดแล้ว", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: back, exact: true }).click();
}
test("Thai navigation, offline cold open, privacy clearing and accessibility", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
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
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "รายการยา", exact: true }),
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
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
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
  await syncNow(page);
  expect((await uploaded).status()).toBe(200);
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
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
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
  await syncNow(page);
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
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
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
  await syncNow(page);
  const card = page.locator("article", { hasText: name });
  // Dose times show as colour-coded parts of the day, not clock times.
  await expect(card.locator(".period-morning")).toHaveText(/เช้า/);
  await expect(card.locator(".period-evening")).toHaveText(/เย็น/);
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
  await syncNow(page);
  await expect(card.locator(".period-noon")).toHaveText(/กลางวัน/);
});
test("row edit and delete buttons, daily schedule view, and clear all data", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  const stamp = Date.now();
  await page.goto("/");
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
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
  await syncNow(page);
  // Daily schedule groups medicines by part of the day.
  await page.getByRole("button", { name: "ตารางเวลาแต่ละวัน" }).click();
  await expect(
    page.getByRole("heading", { name: "เช้า", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ก่อนนอน", exact: true }),
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
test("an unfinished new medicine can be found and continued", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  const name = "Synthetic draft " + Date.now();
  await page.goto("/");
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("ชื่อยา", { exact: true }).fill(name);
  await form.getByRole("button", { name: "เช้า", exact: true }).click();
  await page.waitForTimeout(1200); // autosave
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  const draft = page.locator(".draft-row", { hasText: name });
  await expect(draft).toBeVisible();
  await draft.getByRole("button", { name: /ทำต่อ/ }).first().click();
  await expect(form.getByLabel("ชื่อยา", { exact: true })).toHaveValue(name);
  await expect(
    form.getByRole("button", { name: "เช้า", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await draft.getByRole("button", { name: /ทิ้ง/ }).click();
  await expect(draft).toHaveCount(0);
});
test("settings tab, language toggle, back from pop-ups and name voice button", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  // Today has no sync button; it lives on the Settings tab with the credit.
  await expect(
    page.getByRole("button", { name: /ซิงค์ข้อมูลตอนนี้/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "การตั้งค่า", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "การตั้งค่า", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /ซิงค์ข้อมูลตอนนี้/ }),
  ).toBeVisible();
  await expect(page.getByText("Sorawut Thamyongkit, M.D.")).toBeVisible();
  // Language toggle at the top switches at once.
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "การตั้งค่า", exact: true }),
  ).toBeVisible();
  // Save the patient's language back to Thai for the other tests.
  await syncNow(page);
  // Every pop-up has a Back button, and the phone's Back also closes it.
  const name = "Amoxicillin " + Date.now();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /กลับ/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("ชื่อยา", { exact: true }).fill(name);
  await form.getByRole("button", { name: "1", exact: true }).click();
  await form.getByRole("button", { name: "เม็ด", exact: true }).click();
  await form.getByRole("button", { name: "เย็น", exact: true }).click();
  await form.getByLabel("ข้อมูลนี้ตรงกับใบสั่งยา").check();
  await form.getByRole("button", { name: /^✓ บันทึก$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator(".med-row", { hasText: name });
  await row.getByRole("button", { name: /เปิดข้อมูลยา/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "รายการยา", exact: true }),
  ).toBeVisible();
  // The voice button reads the medicine name in English.
  await page.evaluate(() => {
    (window as any).spoken = [];
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) =>
      (window as any).spoken.push([u.text, u.lang]);
  });
  await row.getByRole("button", { name: "ฟังเสียงชื่อยา " + name }).click();
  expect(await page.evaluate(() => (window as any).spoken)).toEqual([
    [name, "en-US"],
  ]);
  // The schedule shows the dose under the colour-coded evening group.
  await page.getByRole("button", { name: "ตารางเวลาแต่ละวัน" }).click();
  await expect(
    page.locator(".period-group.period-evening", { hasText: name }),
  ).toBeVisible();
});
test("a dose that becomes due rings and opens big answer buttons with 10/15-minute snooze", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    (window as any).tones = 0;
    (window as any).buzzes = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      (window as any).tones++;
      return create.call(this);
    };
    navigator.vibrate = (p: any) => {
      (window as any).buzzes.push(p);
      return true;
    };
  });
  const name = "Synthetic due " + Date.now();
  // The schedule is in Bangkok time; one minute from now is "due" for the app.
  const soon = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Date.now() + 60000));
  await page.goto("/");
  await page.getByRole("button", { name: "ไทย", exact: true }).click();
  await page.getByRole("button", { name: "ทดลองด้วยข้อมูลสมมติ" }).click();
  await page.getByRole("button", { name: "รายการยา", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มยา" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("ชื่อยา", { exact: true }).fill(name);
  await form.getByRole("button", { name: "1", exact: true }).click();
  await form.getByRole("button", { name: "เม็ด", exact: true }).click();
  await form.getByRole("button", { name: "เช้า", exact: true }).click();
  await form.getByLabel("เวลาที่แน่นอน", { exact: true }).fill(soon);
  await form.getByLabel("ข้อมูลนี้ตรงกับใบสั่งยา").check();
  await form.getByRole("button", { name: /^✓ บันทึก$/ }).click();
  await syncNow(page, "วันนี้");
  // Within one display tick the reminder sheet opens with a sound.
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(name)).toBeVisible({ timeout: 45000 });
  await expect(
    sheet.getByRole("button", { name: /ได้รับยาแล้ว/ }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "⏰ เตือนอีก 10 นาที" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).tones)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).buzzes)).toEqual([
    [500, 200, 500, 200, 900],
  ]);
  await sheet.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A link someone sends cannot answer for the user, even with a due dose.
  await page.evaluate(() => {
    location.hash =
      "#notification=00000000-0000-4000-8000-000000000000&do=taken";
  });
  await page.waitForTimeout(2000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const doseRow = page.locator(".dose-row", { hasText: name });
  await expect(
    doseRow.getByRole("button", { name: /ได้รับยาแล้ว/ }),
  ).toBeVisible({ timeout: 70000 });
  // The row's "remind later" offers the same 10 / 15 minutes.
  await doseRow.getByRole("button", { name: "เตือนภายหลัง" }).click();
  await expect(doseRow.getByRole("button", { name: "10 นาที" })).toBeVisible();
  await doseRow.getByRole("button", { name: "15 นาที" }).click();
  await expect(page.getByText("จะเตือนอีกครั้งใน 15 นาที")).toBeVisible();
  await syncNow(page);
  // Remove the test medicine so its due dose does not ring in other tests.
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "ลบ " + name }).click();
  await syncNow(page);
});
