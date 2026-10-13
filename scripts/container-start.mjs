import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { register } from "tsx/esm/api";
register();
const { productionConfigErrors } = await import("./production-config.ts");
const role = process.argv[2];
const targets = {
  api: "apps/api/src/server.ts",
  worker: "apps/worker/src/main.ts",
  migrate: "db/migrate.ts",
  retention: "scripts/retention.ts",
};
if (!targets[role]) throw new Error("Choose api, worker, migrate or retention");
const errors = productionConfigErrors(process.env);
if (process.env.NODE_ENV === "production" && role === "api") {
  try {
    const info = JSON.parse(await readFile("dist/build-info.json", "utf8"));
    if (!info.supabaseUrl || info.supabaseUrl !== process.env.SUPABASE_URL)
      errors.push(
        "Frontend authentication URL is missing or differs from the runtime; rebuild with public auth values",
      );
    if (info.publicKeyHash === createHash("sha256").update("").digest("hex"))
      errors.push(
        "Frontend publishable authentication key is missing; rebuild with VITE_SUPABASE_ANON_KEY",
      );
  } catch {
    errors.push("Frontend build metadata is missing; rebuild the image");
  }
}
if (errors.length) {
  console.error(
    "Deployment configuration rejected:\n" +
      errors.map((e) => " - " + e).join("\n"),
  );
  process.exit(1);
}
const child = spawn(process.execPath, ["--import", "tsx", targets[role]], {
  stdio: "inherit",
  env: process.env,
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
