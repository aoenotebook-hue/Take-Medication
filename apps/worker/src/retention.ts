import { pool, transaction } from "../../../db/client.js";
import { supabase } from "../../api/src/auth.js";
export async function runRetention(limit = 5, budgetMs = 25000) {
  const deadline = Date.now() + budgetMs;
  let deletedIdentities = 0,
    purgedProfiles = 0;
  if (process.env.SUPABASE_URL) {
    const identities = (
      await pool.query(
        "SELECT user_id FROM account_deletions WHERE provider_deleted_at IS NULL LIMIT $1",
        [limit],
      )
    ).rows;
    for (const identity of identities) {
      if (Date.now() >= deadline) break;
      const { error } = await supabase().auth.admin.deleteUser(
        identity.user_id,
      );
      if (error && error.status !== 404 && error.code !== "user_not_found")
        throw new Error("Identity deletion failed; retry retention job");
      deletedIdentities++;
      await pool.query(
        "UPDATE account_deletions SET provider_deleted_at=now() WHERE user_id=$1",
        [identity.user_id],
      );
    }
  }
  const patients = (
    await pool.query(
      "SELECT id FROM patients WHERE deleted_at<now()-interval '30 days' LIMIT $1",
      [limit],
    )
  ).rows;
  for (const p of patients) {
    if (Date.now() >= deadline) break;
    await purgePatient(p.id);
    purgedProfiles++;
  }
  return { deletedIdentities, purgedProfiles };
}

/** Permanently removes a tombstoned profile's records and private photos. */
export async function purgePatient(id: string) {
  const tombstoned = await pool.query(
    "SELECT 1 FROM patients WHERE id=$1 AND deleted_at IS NOT NULL",
    [id],
  );
  if (!tombstoned.rowCount) throw new Error("Only removed profiles are purged");
  const photos = (
    await pool.query("SELECT storage_key FROM photos WHERE patient_id=$1", [id])
  ).rows;
  if (photos.length && process.env.SUPABASE_URL) {
    const { error } = await supabase()
      .storage.from(process.env.PRIVATE_PHOTO_BUCKET || "medication-photos")
      .remove(photos.map((x) => x.storage_key));
    if (error)
      throw new Error("Private storage purge failed; retry retention job");
  }
  await transaction(async (c) => {
    await c.query(
      "DELETE FROM push_observations WHERE job_id IN (SELECT id FROM reminder_jobs WHERE patient_id=$1)",
      [id],
    );
    await c.query(
      "DELETE FROM push_attempts WHERE job_id IN (SELECT id FROM reminder_jobs WHERE patient_id=$1)",
      [id],
    );
    await c.query(
      "DELETE FROM regimen_supersessions WHERE regimen_id IN (SELECT id FROM regimen_versions WHERE patient_id=$1)",
      [id],
    );
    for (const table of [
      "reminder_jobs",
      "reminder_preferences",
      "snoozes",
      "dose_events",
      "dose_occurrences",
      "photos",
      "regimen_versions",
      "schedule_issues",
      "medications",
      "invitations",
      "audit_events",
      "change_feed",
      "memberships",
    ])
      await c.query("DELETE FROM " + table + " WHERE patient_id=$1", [id]);
    await c.query("DELETE FROM patients WHERE id=$1", [id]);
  });
}
