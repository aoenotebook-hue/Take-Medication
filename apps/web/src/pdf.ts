import fontUrl from "./assets/NotoSansThai.ttf?url";
import { db, type Snapshot } from "./storage";
let fontPromise: Promise<string> | undefined;
export async function font() {
  fontPromise ||= (async () => {
    const cached = await db.meta.get("thai-font");
    if (cached) return cached.value as string;
    const b = await (await fetch(fontUrl)).arrayBuffer();
    let str = "";
    for (const v of new Uint8Array(b)) str += String.fromCharCode(v);
    const base64 = btoa(str);
    await db.meta.put({ key: "thai-font", value: base64 });
    return base64;
  })();
  try {
    return await fontPromise;
  } catch (e) {
    fontPromise = undefined;
    throw e;
  }
}
export function summaryRows(s: Snapshot) {
  const at = Date.now();
  return s.medications.map((m) => {
    const versions = s.regimens
      .filter((r) => r.medication_id === m.id)
      .sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at));
    const current = versions
      .filter((r) => Date.parse(r.effective_at) <= at)
      .at(-1);
    const future = versions.filter((r) => Date.parse(r.effective_at) > at);
    return { medicine: m, current, future };
  });
}
export async function exportPdf(s: Snapshot, pending: boolean) {
  const pdfMake = (await import("pdfmake/build/pdfmake")).default;
  const fontData = await font();
  pdfMake.addVirtualFileSystem({ "NotoSansThai.ttf": fontData });
  pdfMake.fonts = {
    Thai: {
      normal: "NotoSansThai.ttf",
      bold: "NotoSansThai.ttf",
      italics: "NotoSansThai.ttf",
      bolditalics: "NotoSansThai.ttf",
    },
  };
  await pdfMake
    .createPdf(buildSummaryDocument(s, pending))
    .download("medication-summary.pdf");
}
export function buildSummaryDocument(s: Snapshot, pending: boolean) {
  const rows = summaryRows(s);
  const doc: any = {
    defaultStyle: { font: "Thai", fontSize: 13 },
    pageMargins: [30, 35, 30, 35],
    content: [
      { text: "รายการยา / Medication list", fontSize: 22 },
      s.profile.data.displayName,
      s.profile.data.dob || "DOB: —",
      "Patient/caregiver-reported. Please reconcile with prescriptions and actual medicines.\nรายการยาที่ผู้ป่วยหรือผู้ดูแลบันทึก โปรดตรวจสอบกับใบสั่งยาและยาที่ใช้จริง",
      `Generated: ${new Date().toISOString()} · Last server sync: ${s.serverAt}`,
      `Allergies / ประวัติแพ้ยา: ${s.profile.data.allergyStatus}\n${s.profile.data.allergies.map((a: any) => `${a.substance}: ${a.reaction} (${a.source})`).join("\n")}`,
      pending
        ? "PENDING LOCAL CHANGES / การเปลี่ยนแปลงยังไม่ซิงค์"
        : "Server-confirmed snapshot",
      {
        table: {
          headerRows: 1,
          dontBreakRows: rows.every(
            ({ current: r }) => (r?.data.instructions?.length || 0) < 1500,
          ),
          widths: ["*", "*"],
          body: [
            ["Medicine / ยา", "Instructions / วิธีใช้"],
            ...rows.map(({ medicine: m, current: r, future }) => [
              `${m.data.name}\n${m.data.generic} ${m.data.brand}\n${m.data.strength}\n${m.data.productType}\n${m.data.verified ? "Verification recorded" : "Unverified / ยังไม่ตรวจสอบ"}`,
              `${r?.data.status || "draft"}\n${r?.data.instructions || "Unknown instructions"}\n${r?.data.route || m.data.route}\n${r?.data.slots.map((x: any) => `${x.time} · ${x.amount} ${x.unit}`).join("\n") || ""}\n${r?.data.food || ""}\n${r?.data.start || ""} — ${r?.data.end || ""}\nSource: ${r?.data.source || m.data.source}\n${future.map((f: any) => "Future " + f.effective_at + ": " + f.data.instructions).join("\n")}`,
            ]),
          ],
        },
        layout: "lightHorizontalLines",
      },
    ],
    footer: (page: number, total: number) => ({
      text: `${page} / ${total}`,
      alignment: "center",
      font: "Thai",
      fontSize: 11,
    }),
  };
  return doc;
}
