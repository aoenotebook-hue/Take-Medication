import "dotenv/config";
import pg from "pg";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://medication:local-only@localhost:5432/medication",
  max: 10,
});
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
