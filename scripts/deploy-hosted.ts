import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pool } from "../db/client";
const token = process.env.VERCEL_TOKEN;
const commit = process.env.DEPLOY_COMMIT;
if (
  !token ||
  !commit ||
  !/^[a-f0-9]{40}$/.test(commit) ||
  !process.env.DATABASE_URL
)
  throw new Error(
    "Set VERCEL_TOKEN, DATABASE_URL and the verified 40-character DEPLOY_COMMIT",
  );
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(
    "https://api.vercel.com" +
      path +
      (path.includes("?") ? "&" : "?") +
      "slug=aoe5",
    {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw new Error("Vercel API failed (HTTP " + r.status + ")");
  return r.json();
}
try {
  const project = await api("/v9/projects/take-medication");
  if (
    project.link?.org !== "aoenotebook-hue" ||
    project.link?.repo !== "Take-Medication" ||
    !project.link?.repoId
  )
    throw new Error(
      "Selected project is not connected to the authorized repository",
    );
  const existing = (await api("/v10/projects/" + project.id + "/env")).envs;
  const runtime: Record<string, string> = {};
  for (const key of [
    "PUBLIC_APP_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "CRON_SECRET",
  ]) {
    const env = existing.find(
      (e: any) =>
        e.key === key && e.target?.includes("production") && !e.gitBranch,
    );
    if (!env) throw new Error("Run configure:hosted first; missing " + key);
    runtime[key] = (
      await api("/v1/projects/" + project.id + "/env/" + env.id)
    ).value;
    if (!runtime[key])
      throw new Error("Cannot read the required production configuration");
  }
  const deployment = await api("/v13/deployments", "POST", {
    name: "take-medication",
    project: project.id,
    target: "production",
    gitSource: { type: "github", repoId: project.link.repoId, ref: commit },
  });
  console.log("Created production deployment: " + deployment.id);
  let ready = false,
    last = "";
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const d = await api("/v13/deployments/" + deployment.id);
    const state = d.readyState || d.status;
    if (state !== last) console.log("Deployment state: " + state);
    last = state;
    if (state === "READY") {
      ready = true;
      break;
    }
    if (["ERROR", "CANCELED"].includes(state))
      throw new Error("Deployment failed; inspect Vercel build logs");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (!ready)
    throw new Error(
      "Deployment is still building; no successful deployment is claimed",
    );
  const checked = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-live.ts"],
    { env: { ...process.env, ...runtime }, stdio: "inherit" },
  );
  if (checked.status !== 0)
    throw new Error("Live checks failed; scheduler was not enabled");
  await pool.query(
    await readFile(
      new URL("../deploy/supabase-cron.sql", import.meta.url),
      "utf8",
    ),
  );
  const scheduled = await fetch(
    runtime.PUBLIC_APP_URL + "/api/internal/reminders",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + runtime.CRON_SECRET,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(55000),
    },
  );
  if (!scheduled.ok) throw new Error("Scheduler invocation failed");
  // A successful manual invocation checks the handler; wait for the separate
  // Cron HTTP request to prove automatic invocation too.
  const manualAt = new Date();
  let cronWorked = false;
  const cronDeadline = Date.now() + 140000;
  while (Date.now() < cronDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const state = await pool.query(
      "SELECT heartbeat FROM worker_health WHERE id='worker' AND heartbeat>$1",
      [manualAt],
    );
    if (state.rowCount) {
      cronWorked = true;
      break;
    }
  }
  if (!cronWorked)
    throw new Error(
      "Manual worker passed but automatic Cron heartbeat is missing; inspect cron.job_run_details and net._http_response",
    );
  console.log(
    "Production app and automatic reminder scheduler checked: " +
      runtime.PUBLIC_APP_URL,
  );
} catch (e) {
  console.error(
    e instanceof Error && !("code" in e)
      ? e.message
      : "Deployment/database check failed; inspect permissions and TLS without printing secrets.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
