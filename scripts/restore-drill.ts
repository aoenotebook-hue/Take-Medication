import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
const env = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgres://medication:local-only@localhost:5432/medication",
  BACKUP_LOCAL_DOCKER: "true",
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
async function run(cmd: string, args: string[], vars = env) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: vars,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    p.stdout.on("data", (s) => (output += s));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error("Restore drill command failed")),
    );
  });
}
await run("npx", ["tsx", "scripts/backup.ts"]);
const file = (await readdir("backups"))
  .filter((f) => f.endsWith(".dump.enc"))
  .sort()
  .at(-1)!;
const name = "restore_drill_" + Date.now();
await run("docker", [
  "compose",
  "exec",
  "-T",
  "db",
  "createdb",
  "-U",
  "medication",
  name,
]);
try {
  await run("npx", ["tsx", "scripts/restore.ts", "backups/" + file], {
    ...env,
    DATABASE_URL: "postgres://medication:local-only@localhost:5432/" + name,
    RESTORE_CONFIRM: "RESTORE_ISOLATED_DATABASE",
  } as typeof env);
  const sql =
    "SELECT (SELECT count(*) FROM medications),(SELECT count(*) FROM dose_events),(SELECT count(*) FROM memberships),(SELECT count(*) FROM audit_events),(SELECT count(*) FROM photos)";
  const original = await run("docker", [
    "compose",
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "medication",
    "-d",
    "medication",
    "-tAc",
    sql,
  ]);
  const restored = await run("docker", [
    "compose",
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "medication",
    "-d",
    name,
    "-tAc",
    sql,
  ]);
  if (original !== restored) throw new Error("Restore counts differ");
  console.log(
    "Backup/restore drill passed for medications, dose events, memberships, audit and photos.",
  );
} finally {
  await run("docker", [
    "compose",
    "exec",
    "-T",
    "db",
    "dropdb",
    "-U",
    "medication",
    name,
  ]);
}
