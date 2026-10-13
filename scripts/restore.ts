import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createDecipheriv } from "node:crypto";
import { spawn } from "node:child_process";
if (process.env.RESTORE_CONFIRM !== "RESTORE_ISOLATED_DATABASE")
  throw new Error(
    "Restore only into an empty isolated database; set RESTORE_CONFIRM=RESTORE_ISOLATED_DATABASE",
  );
const bytes = await readFile(process.argv[2]);
const k = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
const d = createDecipheriv("aes-256-gcm", k, bytes.subarray(0, 12));
d.setAuthTag(bytes.subarray(12, 28));
const plain = Buffer.concat([d.update(bytes.subarray(28)), d.final()]);
const url = new URL(process.env.DATABASE_URL!);
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1),
  PGSSLMODE: url.searchParams.get("sslmode") || "prefer",
};
const args =
  process.env.BACKUP_LOCAL_DOCKER === "true"
    ? [
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "db",
          "pg_restore",
          "-U",
          "medication",
          "-d",
          url.pathname.slice(1),
          "--exit-on-error",
          "--no-owner",
        ],
      ]
    : [
        "pg_restore",
        ["--exit-on-error", "--no-owner", "-d", url.pathname.slice(1)],
      ];
await new Promise<void>((resolve, reject) => {
  const p = spawn(args[0] as string, args[1] as string[], {
    env,
    stdio: ["pipe", "ignore", "inherit"],
  });
  p.stdin.end(plain);
  p.on("error", reject);
  p.on("exit", (c) =>
    c === 0
      ? resolve()
      : reject(
          new Error(
            "Restore failed; retain original backup and inspect isolated database.",
          ),
        ),
  );
});
console.log(
  "Restore complete. Verify records and device re-registration before any cutover.",
);
