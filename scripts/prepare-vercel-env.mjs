import { access, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const envPath = ".env.vercel-missing";
const cronPath = ".env.supabase-reminders.sql";
for (const path of [envPath, cronPath]) {
  try {
    await access(path);
  } catch (e) {
    if (e.code === "ENOENT") continue;
    throw e;
  }
  throw new Error(
    "Setup file already exists; preserve its keys instead of generating replacements: " +
      path,
  );
}
const vapid = webpush.generateVAPIDKeys();
const encryption = randomBytes(32).toString("base64");
const cron = randomBytes(32).toString("base64url");
const origin = "https://take-medication.vercel.app";
const values = {
  PUBLIC_APP_URL: origin,
  DATABASE_URL:
    "replace-with-your-Supabase-pooled-PostgreSQL-connection-string",
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: origin,
  PUSH_ENCRYPTION_KEY: encryption,
  CRON_SECRET: cron,
  NODEJS_HELPERS: "0",
  LOCAL_DEMO: "false",
  PUSH_ADAPTER: "webpush",
};
const env =
  "# Private setup file. Replace DATABASE_URL, import into Vercel Production, and redeploy.\n" +
  "# Keep these keys stable. Existing Supabase URL/service-role/frontend variables remain configured in Vercel.\n" +
  Object.entries(values)
    .map(([key, value]) => key + "=" + value)
    .join("\n") +
  "\n";
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const cronSql =
  "-- Private: contains the scheduler credential. Run AFTER the API health endpoint reports database reachable.\nBEGIN;\n" +
  "DO $medication_vault$\nDECLARE existing uuid;\nBEGIN\n" +
  [
    ["medication_app_url", origin],
    ["medication_cron_secret", cron],
  ]
    .map(
      ([name, value]) =>
        `  SELECT id INTO existing FROM vault.secrets WHERE name=${quote(name)};\n` +
        `  IF existing IS NULL THEN PERFORM vault.create_secret(${quote(value)},${quote(name)});\n` +
        `  ELSE PERFORM vault.update_secret(existing,${quote(value)},${quote(name)}); END IF;\n`,
    )
    .join("") +
  "END $medication_vault$;\n" +
  (await readFile("deploy/supabase-cron.sql", "utf8")) +
  "\nCOMMIT;\n";
await writeFile(envPath, env, { mode: 0o600, flag: "wx" });
await writeFile(cronPath, cronSql, { mode: 0o600, flag: "wx" });
console.log("Prepared private files: " + envPath + " and " + cronPath);
console.log(
  "Secret values were not printed. Replace DATABASE_URL in the environment file before importing it.",
);
