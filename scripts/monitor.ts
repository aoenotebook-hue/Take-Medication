import { pool } from "../db/client";
const health = (
  await pool.query(
    "SELECT id,extract(epoch from now()-heartbeat)::integer age, horizon_at FROM worker_health",
  )
).rows;
const queue = (
  await pool.query(
    "SELECT state,count(*)::integer count FROM reminder_jobs GROUP BY state",
  )
).rows;
const lag = (
  await pool.query(
    "SELECT COALESCE(max(extract(epoch from now()-due_at)),0)::integer lag FROM reminder_jobs WHERE state='queued' AND due_at<=now() AND expires_at>now()",
  )
).rows[0].lag;
const providers = (
  await pool.query(
    "SELECT state,count(*)::integer count FROM push_attempts WHERE attempted_at>now()-interval '1 hour' GROUP BY state",
  )
).rows;
const scheduleIssues = Number(
  (await pool.query("SELECT count(*) FROM schedule_issues")).rows[0].count,
);
console.log(
  JSON.stringify(
    { health, queue, dueLagSeconds: lag, providers, scheduleIssues },
    null,
    2,
  ),
);
// Supabase Cron runs the worker once a minute, so a 60-second limit raised
// false alarms on normal jitter. Default 180 s; override per hosting mode.
const staleSeconds = Number(process.env.WORKER_STALE_SECONDS || 180);
const worker = health.find((h) => h.id === "worker"),
  scheduler = health.find((h) => h.id === "scheduler");
if (
  !worker ||
  worker.age > staleSeconds ||
  !scheduler ||
  !scheduler.horizon_at ||
  new Date(scheduler.horizon_at) < new Date(Date.now() + 86400000) ||
  lag > staleSeconds ||
  scheduleIssues > 0
)
  process.exitCode = 1;
await pool.end();
