import React from "react";
import {
  drugUse,
  type AutomaticInformation,
} from "../../../../packages/domain/src/drug-uses";
import type { DrugIdentity } from "../../../../packages/domain/src/drug-information";
export function DrugUseSummary({
  medicine,
  information,
  lang,
}: {
  medicine: DrugIdentity & { purpose?: string };
  information?: AutomaticInformation;
  lang: "th" | "en";
}) {
  const use = drugUse(medicine, information, lang);
  return (
    <small className="drug-use-summary">
      {use ? (
        <>
          <span>
            {lang === "th"
              ? use.kind === "general"
                ? "ใช้ทั่วไป: "
                : "เหตุผลที่บันทึก: "
              : use.kind === "general"
                ? "Common use: "
                : "Recorded reason: "}
          </span>
          {use.text}
        </>
      ) : lang === "th" ? (
        "ยังไม่มีข้อมูลการใช้ยาที่ยืนยัน"
      ) : (
        "Use information not yet confirmed"
      )}
    </small>
  );
}
