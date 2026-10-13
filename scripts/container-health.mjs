const role = process.argv[2];
try {
  if (role === "api") {
    const response = await fetch(
      "http://127.0.0.1:" + String(process.env.PORT || 3001) + "/api/health",
      { signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok || (await response.json()).database !== "reachable")
      process.exitCode = 1;
  } else if (role === "worker") {
    const { default: pg } = await import("pg");
    const db = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await db.connect();
      const result = await db.query(
        "SELECT extract(epoch from now()-heartbeat) age FROM worker_health WHERE id='worker'",
      );
      if (!result.rowCount || Number(result.rows[0].age) > 60)
        process.exitCode = 1;
    } finally {
      await db.end();
    }
  } else process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
