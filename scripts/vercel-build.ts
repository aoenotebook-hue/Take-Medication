import { spawnSync } from "node:child_process";
import { publicAuthConfig } from "./public-auth-config.js";
const { url, key } = publicAuthConfig(process.env);
const buildEnv = {
  ...process.env,
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: key,
};
for (const args of [
  ["run", "typecheck"],
  ["run", "build"],
]) {
  const r = spawnSync("npm", args, { stdio: "inherit", env: buildEnv });
  if (r.status !== 0) process.exit(r.status || 1);
}
