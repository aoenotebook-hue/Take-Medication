import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(join(root, ".vercel"), { recursive: true });
const output = await mkdtemp(join(root, ".vercel/api-check-"));
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "-p",
      "api/tsconfig.json",
      "--noEmit",
      "false",
      "--rewriteRelativeImportExtensions",
      "--outDir",
      output,
    ],
    { cwd: root, stdio: "inherit" },
  );
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  // Import the emitted JavaScript with plain Node and production startup checks.
  // No tsx loader, listening server, network request, or real credential is used.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const m = await import(process.argv[1]);
    assert.equal(typeof m.default, 'function');
    assert.equal(m.config.supportsResponseStreaming, true);
    const {pool} = await import(process.argv[2]);
    await pool.end();
    console.log('Compiled production API startup passed');
  `,
      pathToFileURL(join(output, "api/index.js")).href,
      pathToFileURL(join(output, "db/client.js")).href,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        VERCEL: "1",
        NODE_ENV: "production",
        LOCAL_DEMO: "false",
        PUSH_ADAPTER: "webpush",
        PUBLIC_APP_URL: "https://synthetic.example.invalid",
        DATABASE_URL: "postgresql://synthetic:unused@127.0.0.1:1/synthetic",
        SUPABASE_URL: "https://qfiplelamyjwvexosmii.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-only-no-network",
        VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"),
        VAPID_PRIVATE_KEY: curve.getPrivateKey().toString("base64url"),
        VAPID_SUBJECT: "https://synthetic.example.invalid",
        PUSH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        CRON_SECRET: randomBytes(32).toString("base64url"),
      },
    },
  );
} finally {
  await rm(output, { recursive: true, force: true });
}
