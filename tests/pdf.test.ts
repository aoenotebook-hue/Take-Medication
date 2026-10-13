import { it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSummaryDocument } from "../apps/web/src/pdf";
import type { Snapshot } from "../apps/web/src/storage";
for (const count of [1, 10, 30])
  it(`renders ${count} medicine Thai PDF with pagination and embedded font`, async () => {
    const pdfMake = (await import("pdfmake")).default as any;
    const path = resolve("apps/web/src/assets/NotoSansThai.ttf");
    pdfMake.addFonts({
      Thai: { normal: path, bold: path, italics: path, bolditalics: path },
    });
    const s: Snapshot = {
      profile: {
        data: {
          displayName: "ผู้ป่วยสมมติ / Synthetic patient",
          allergyStatus: "unknown",
          allergies: [],
        },
      },
      role: "owner",
      medications: [],
      regimens: [],
      events: [],
      photos: [],
      auditEvents: [],
      occurrences: [],
      cursor: "0",
      serverAt: new Date().toISOString(),
    };
    for (let i = 0; i < count; i++) {
      s.medications.push({
        id: String(i),
        data: {
          name: `ยาตัวอย่าง ${i + 1} / Synthetic ${i + 1}`,
          generic: "",
          brand: "",
          strength: "5 mg + 10 mg",
          route: "oral",
          productType: i === 0 ? "supplement" : "prescription",
          source: "Original synthetic label",
          verified: false,
        },
      });
      s.regimens.push({
        id: "r" + i,
        medication_id: String(i),
        effective_at: "2026-01-01T00:00:00Z",
        data: {
          status: i === 0 ? "stopped" : "active",
          instructions:
            "คำแนะนำสมมติจากฉลาก ไม่มีคำแนะนำทางการแพทย์ / Original synthetic instruction",
          route: "oral",
          slots: [{ time: "08:00", amount: "0.5", unit: "tablet" }],
          food: "Original food instruction",
          start: "2026-01-01",
          source: "Synthetic label",
        },
      });
    }
    const buffer: Buffer = await pdfMake
      .createPdf(buildSummaryDocument(s, true))
      .getBuffer();
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.toString("latin1")).toContain("/FontFile2");
    const pages =
      buffer.toString("latin1").match(/\/Type \/Page\b/g)?.length || 0;
    expect(pages).toBeGreaterThanOrEqual(count === 1 ? 1 : 2);
    await mkdir("test-results", { recursive: true });
    await writeFile(`test-results/thai-${count}.pdf`, buffer);
  });
