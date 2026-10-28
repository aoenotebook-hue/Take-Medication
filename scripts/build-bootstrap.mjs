import { readFile, writeFile } from "node:fs/promises";
const versions = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const chunks = [];
for (const version of versions) {
  const sql = await readFile(`db/00${version}.sql`, "utf8");
  if (sql.includes("$medication_bootstrap$"))
    throw new Error("Migration delimiter conflict");
  chunks.push(
    `  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=${version}) THEN\n${sql}\n  END IF;`,
  );
}
const sql = `-- Generated from db/001.sql through db/009.sql by npm run build:bootstrap.
-- Run in the selected Supabase project's SQL editor. No synthetic patient data is seeded.
-- Existing numbered migrations are skipped; failures roll back the entire transaction.
BEGIN;
SELECT pg_advisory_xact_lock(846101);
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY);
DO $medication_bootstrap$
BEGIN
${chunks.join("\n")}
END $medication_bootstrap$;
-- Require API authorization for private photos even if another bucket uses broad policies.
DO $medication_storage$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL AND
     EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND
     EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    DROP POLICY IF EXISTS medication_photos_api_only ON storage.objects;
    CREATE POLICY medication_photos_api_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
      USING(bucket_id<>'medication-photos') WITH CHECK(bucket_id<>'medication-photos');
  END IF;
END $medication_storage$;
COMMIT;
`;
await writeFile("deploy/supabase-bootstrap.sql", sql);
console.log("Generated deploy/supabase-bootstrap.sql");
