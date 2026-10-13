import "dotenv/config";
import pg from "pg";
import { rootCertificates } from "node:tls";
import { attachDatabasePool } from "@vercel/functions";
import { SUPABASE_ROOT_CA } from "./supabase-ca.js";
// DATE columns (e.g. dose_occurrences.local_date) are calendar days in the
// schedule's timezone. pg's default turns them into Date objects at server-local
// midnight, which serialize as timestamps and never equal "YYYY-MM-DD" in the app.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
const connectionString =
  process.env.DATABASE_URL ||
  "postgres://medication:local-only@localhost:5432/medication";
// Do not let URL sslmode options disable certificate verification in production.
const secureUrl = new URL(connectionString);
if (process.env.NODE_ENV === "production")
  for (const option of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    secureUrl.searchParams.delete(option);
export const pool = new pg.Pool({
  connectionString: secureUrl.toString(),
  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: true,
          // Keep public roots and add Supabase's private root; never disable verification.
          ca: [
            ...rootCertificates,
            SUPABASE_ROOT_CA,
            ...(process.env.DATABASE_SSL_CA
              ? [process.env.DATABASE_SSL_CA]
              : []),
          ],
        }
      : undefined,
  max: process.env.VERCEL ? 3 : 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 5000,
  statement_timeout: process.env.VERCEL ? 15000 : 0,
});
if (process.env.VERCEL) attachDatabasePool(pool);
pool.on("error", (e: any) =>
  console.error(
    "Idle database connection failed; retry required",
    e?.code || e?.name || "unknown",
  ),
);
export async function transaction<T>(
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
