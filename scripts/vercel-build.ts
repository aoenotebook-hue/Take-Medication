import { spawnSync } from "node:child_process";
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key || !url.startsWith("https://") || key.startsWith("sb_secret_"))
  throw new Error(
    "Set VITE_SUPABASE_URL and a public VITE_SUPABASE_ANON_KEY before deployment",
  );
// Never build a service-role JWT into publicly downloadable frontend code.
if (key.split(".").length === 3) {
  const claims = JSON.parse(
    Buffer.from(key.split(".")[1], "base64url").toString(),
  );
  if (claims.role !== "anon")
    throw new Error("Frontend key must have anon role");
}
for (const args of [
  ["run", "typecheck"],
  ["run", "build"],
]) {
  const r = spawnSync("npm", args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
