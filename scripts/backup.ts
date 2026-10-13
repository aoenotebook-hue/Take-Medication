import "dotenv/config";
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
if (key.length !== 32)
  throw new Error("BACKUP_ENCRYPTION_KEY must encode 32 bytes");
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
          "pg_dump",
          "-U",
          "medication",
          "-d",
          "medication",
          "-Fc",
        ],
      ]
    : ["pg_dump", ["-Fc"]];
const result = await new Promise<Buffer>((resolve, reject) => {
  const p = spawn(args[0] as string, args[1] as string[], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  p.stdout.on("data", (b) => chunks.push(b));
  p.on("error", reject);
  p.on("exit", (code) =>
    code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error("Backup failed; inspect database availability.")),
  );
});
const iv = randomBytes(12),
  c = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([c.update(result), c.final()]);
const name = `backups/${new Date().toISOString().replaceAll(":", "-")}.dump.enc`;
await mkdir("backups", { recursive: true });
await writeFile(name, Buffer.concat([iv, c.getAuthTag(), encrypted]), {
  mode: 0o600,
});
console.log("Encrypted backup saved: " + name);
