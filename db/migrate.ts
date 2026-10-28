import { readFile } from "node:fs/promises";
import { pool, transaction } from "./client.js";
await transaction(async (c) => {
  await c.query("SELECT pg_advisory_xact_lock(846101)");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY)",
  );
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    if (
      !(
        await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
          version,
        ])
      ).rowCount
    )
      await c.query(
        await readFile(
          new URL(`./${String(version).padStart(3, "0")}.sql`, import.meta.url),
          "utf8",
        ),
      );
});
await pool.end();
console.log("Migrations complete");
