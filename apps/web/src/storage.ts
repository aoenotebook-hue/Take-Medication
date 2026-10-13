import Dexie, { type EntityTable } from "dexie";
import type { Operation } from "../../api/src/service";
export type Snapshot = {
  profile: any;
  role: string;
  medications: any[];
  regimens: any[];
  retiredRegimens?: any[];
  occurrences: any[];
  events: any[];
  photos: any[];
  auditEvents: any[];
  scheduleIssues?: any[];
  cursor: string;
  serverAt: string;
};
export const db = new Dexie("medication-private") as Dexie & {
  snapshots: EntityTable<{ key: string; value: Snapshot }, "key">;
  outbox: EntityTable<
    Operation & {
      actor: string;
      state: string;
      sequence?: number;
      error?: string;
      current?: any;
    },
    "id"
  >;
  photos: EntityTable<
    {
      id: string;
      patientId: string;
      blob: Blob;
      medicationId?: string;
      pending?: boolean;
      actor?: string;
    },
    "id"
  >;
  drafts: EntityTable<{ id: string; value: any }, "id">;
  meta: EntityTable<{ key: string; value: any }, "key">;
};
db.version(1).stores({
  snapshots: "key",
  outbox: "id,actor,patientId,state",
  photos: "id,patientId",
  drafts: "id",
  meta: "key",
});
db.version(2).stores({ outbox: "id,actor,patientId,state,sequence" });
export async function clearPrivate() {
  await Promise.all(db.tables.map((t) => t.clear()));
}
export function localView(snapshot: Snapshot, ops: Operation[]) {
  const s = structuredClone(snapshot);
  for (const op of [...ops].sort(
    (a: any, b: any) =>
      (a.sequence || Date.parse(a.clientAt) * 1000) -
      (b.sequence || Date.parse(b.clientAt) * 1000),
  )) {
    if (op.kind === "profile") {
      s.profile.data = op.data;
      s.profile.version = op.baseVersion + 1;
    }
    if (op.kind === "medication") {
      const row = s.medications.find((m) => m.id === op.resourceId);
      if (row) {
        row.data = op.data;
        row.version = op.baseVersion + 1;
      } else
        s.medications.push({
          id: op.resourceId,
          patient_id: op.patientId,
          data: op.data,
          version: 1,
        });
    }
    if (op.kind === "regimen") {
      s.regimens = s.regimens.filter(
        (r) =>
          r.medication_id !== op.resourceId ||
          Date.parse(r.effective_at) < Date.parse(op.data.effectiveAt),
      );
      s.regimens.push({
        id: "pending-" + op.id,
        medication_id: op.resourceId,
        data: op.data,
        effective_at: op.data.effectiveAt,
        version: op.baseVersion + 1,
        pending: true,
      });
      const m = s.medications.find((m) => m.id === op.resourceId);
      if (m) m.version = op.baseVersion + 1;
    }
    if (op.kind === "dose")
      s.events.push({
        id: op.id,
        occurrence_id: op.data.occurrenceId,
        medication_id: op.data.medicationId,
        action: op.data.action,
        base_event_ids: op.data.baseEventIds,
        actual_at: op.data.actualAt,
        client_at: op.clientAt,
        data: op.data,
        pending: true,
      });
  }
  return s;
}
