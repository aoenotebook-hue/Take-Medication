import React, { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { db } from "../storage";
import type { MonthlyReport as Report } from "../../../../packages/domain/src/monthly-report";
type Props = {
  actor: string;
  patientId: string;
  patientName: string;
  timezone: string;
  lang: "th" | "en";
  pending: boolean;
  request: (
    path: string,
    body?: any,
    method?: string,
    signal?: AbortSignal,
  ) => Promise<any>;
};
export function MonthlyReport({
  actor,
  patientId,
  patientName,
  timezone,
  lang,
  pending,
  request,
}: Props) {
  const t = (th: string, en: string) => (lang === "th" ? th : en);
  const [month, setMonth] = useState(
    DateTime.now().setZone(timezone).toFormat("yyyy-MM"),
  );
  const [report, setReport] = useState<Report>(),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const controller = new AbortController(),
      key = "monthly-report:" + actor + ":" + patientId + ":" + month;
    setReport(undefined);
    setBusy(true);
    setError("");
    setOffline(false);
    void (async () => {
      try {
        const cached = await db.meta.get(key);
        if (active && cached) setReport(cached.value);
        const r: Report = await request(
          "/patients/" +
            patientId +
            "/monthly-report?month=" +
            encodeURIComponent(month),
          undefined,
          "GET",
          controller.signal,
        );
        if (!active) return;
        setReport(r);
        await db.transaction("rw", db.meta, async () => {
          if (active && (await db.meta.get("actor"))?.value === actor)
            await db.meta.put({ key, value: r });
        });
      } catch (e: any) {
        if (active) {
          setOffline(true);
          if (e.status === 403 || e.status === 401) {
            setReport(undefined);
            await db.meta.delete(key);
          }
          setError(
            t(
              "โหลดรายงานล่าสุดไม่ได้ ถ้ามีจะแสดงฉบับที่เก็บไว้",
              "Could not load the latest report. Showing a saved copy when available.",
            ),
          );
        }
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [actor, patientId, month]);
  const percent = (v: number | null) =>
    v === null
      ? "—"
      : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(v) +
        "%";
  return (
    <section
      aria-label={t("รายงานการใช้ยารายเดือน", "Monthly medicine report")}
      className="monthly-report"
    >
      <p>
        <strong>{patientName}</strong>
      </p>
      <label>
        {t("เดือน", "Month")}
        <input
          type="month"
          value={month}
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
      </label>
      <p className="muted">
        {t(
          "รวมเฉพาะตารางยาที่บันทึกในแอป นับเฉพาะเวลายาที่ถึงกำหนดแล้ว ไม่รวมเวลาในอนาคต การไม่มีบันทึกไม่ได้ยืนยันว่าลืมใช้ยา",
          "Includes schedules recorded by this app. Only doses already due are counted; future times are excluded. No record does not prove a missed dose.",
        )}
      </p>
      {pending && (
        <p className="warning">
          {t(
            "มีข้อมูลในโทรศัพท์ที่ยังไม่ซิงค์ รายงานใช้ข้อมูลที่เซิร์ฟเวอร์รับแล้วเท่านั้น",
            "Some phone records are unsynced. This report uses server-confirmed records only.",
          )}
        </p>
      )}
      {busy && <p role="status">{t("กำลังโหลดรายงาน…", "Loading report…")}</p>}
      {error && <p role="status">{error}</p>}
      {report && (
        <>
          <p>
            {offline
              ? t("ฉบับที่เก็บไว้", "Saved copy")
              : t("ข้อมูลล่าสุด", "Latest records")}{" "}
            ·{" "}
            {DateTime.fromISO(report.generatedAt)
              .setZone(timezone)
              .setLocale(lang)
              .toLocaleString(DateTime.DATETIME_MED)}{" "}
            · {report.timezone}
          </p>
          <div className="report-totals">
            <p>
              <strong>{report.totals.scheduled}</strong>{" "}
              {t("ครั้งที่ถึงกำหนด", "doses due")}
            </p>
            <p>
              <strong>
                {report.totals.taken} ({percent(report.totals.takenPercent)})
              </strong>{" "}
              {t("บันทึกว่าใช้ยาแล้ว", "recorded taken")}
            </p>
            <p>
              <strong>
                {report.totals.notRecorded} (
                {percent(report.totals.notRecordedPercent)})
              </strong>{" "}
              {t("ข้ามหรือไม่มีบันทึก", "skipped or no record")}
            </p>
          </div>
          <p className="hint">
            {t(
              "เลื่อนตารางไปด้านข้างเพื่อดูทุกคอลัมน์",
              "Scroll the table sideways to see all columns.",
            )}
          </p>
          <div
            className="report-scroll"
            role="region"
            aria-label={t(
              "ตารางรายงาน เลื่อนแนวนอนได้",
              "Report table, scroll horizontally",
            )}
            tabIndex={0}
          >
            <table>
              <caption>
                {t("การใช้ยาตามเวลาที่กำหนด", "Scheduled medicine records")}
              </caption>
              <thead>
                <tr>
                  {[
                    t("ยา", "Medicine"),
                    t("ถึงกำหนด (ครั้ง)", "Due"),
                    t("ใช้แล้ว (ครั้ง/%)", "Taken (count/%)"),
                    t("ข้าม (ครั้ง)", "Skipped"),
                    t("ไม่มีบันทึก (ครั้ง)", "No record"),
                    t("ข้ามหรือไม่มีบันทึก (%)", "Skipped/no record (%)"),
                  ].map((h) => (
                    <th scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                  {report.totals.conflict > 0 && (
                    <th scope="col">{t("ต้องตรวจสอบ", "Needs review")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...report.rows, report.totals].map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      {r.id === "total" ? t("รวม", "Total") : r.name}
                    </th>
                    <td>{r.scheduled}</td>
                    <td>
                      {r.taken} / {percent(r.takenPercent)}
                    </td>
                    <td>{r.skipped}</td>
                    <td>{r.unconfirmed}</td>
                    <td>{percent(r.notRecordedPercent)}</td>
                    {report.totals.conflict > 0 && <td>{r.conflict}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!report.totals.scheduled && (
            <p>
              {t(
                "ยังไม่มีเวลายาที่ถึงกำหนดในเดือนนี้",
                "No scheduled doses are due in this month.",
              )}
            </p>
          )}
          <p className="muted">
            {t(
              "เปอร์เซ็นต์ = จำนวนครั้ง ÷ ครั้งที่ถึงกำหนด × 100 ข้ามและไม่มีบันทึกแสดงแยกกัน รายการขัดแย้งต้องตรวจสอบก่อน",
              "Percentage = count ÷ doses due × 100. Skips and missing records remain separate; conflicting records need review.",
            )}
          </p>
          {report.asNeeded.length > 0 && (
            <>
              <h3>
                {t(
                  "ยาเมื่อจำเป็น (ไม่นับในเปอร์เซ็นต์)",
                  "As-needed uses (excluded from percentages)",
                )}
              </h3>
              <ul>
                {report.asNeeded.map((r, i) => (
                  <li key={i}>
                    {r.name}: {r.count} {t("ครั้ง", "times")}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
