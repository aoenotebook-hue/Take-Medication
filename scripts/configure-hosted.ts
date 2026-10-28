import "dotenv/config";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { pool, transaction } from "../db/client";
import { productionConfigErrors } from "./production-config";

// Provision only the two projects explicitly selected by the owner. HTTP error
// messages omit response bodies, SQL and credentials.
const ref = "qfiplelamyjwvexosmii",
  projectName = "take-medication";
const scope = "aoe5";
const required = ["VERCEL_TOKEN", "SUPABASE_ACCESS_TOKEN", "DATABASE_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length)
  throw new Error("Configure environment secrets: " + missing.join(", "));
async function remote(
  base: string,
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw new Error(
      "Hosting API " + method + " failed (HTTP " + r.status + ")",
    );
  return r.status === 204 ? null : r.json();
}
const vercel = (path: string, method = "GET", body?: unknown) =>
  remote(
    "https://api.vercel.com",
    process.env.VERCEL_TOKEN!,
    path + (path.includes("?") ? "&" : "?") + "slug=" + scope,
    method,
    body,
  );
const managed = (path: string, method = "GET", body?: unknown) =>
  remote(
    "https://api.supabase.com",
    process.env.SUPABASE_ACCESS_TOKEN!,
    "/v1/projects/" + ref + path,
    method,
    body,
  );
try {
  const project = await vercel("/v9/projects/" + projectName);
  if (
    project.name !== projectName ||
    project.link?.type !== "github" ||
    project.link?.org !== "aoenotebook-hue" ||
    project.link?.repo !== "Take-Medication"
  )
    throw new Error(
      "The selected Vercel project must be connected to aoenotebook-hue/Take-Medication",
    );
  const domains = await vercel("/v9/projects/" + project.id + "/domains");
  const domain = domains.domains.find(
    (d: any) => !d.redirect && !d.gitBranch,
  )?.name;
  const origin =
    process.env.PUBLIC_APP_URL || (domain ? "https://" + domain : "");
  if (
    !origin ||
    !domains.domains.some((d: any) => "https://" + d.name === origin)
  )
    throw new Error("PUBLIC_APP_URL must match a configured production domain");
  const settings = await managed("/config/auth");
  if (!settings.smtp_host)
    throw new Error(
      "Configure custom SMTP in Supabase Auth first; the default mail service cannot support public sign-in",
    );
  const keys = await managed("/api-keys");
  const publicKey = keys.find((k: any) => k.name === "anon")?.api_key;
  const serviceKey = keys.find((k: any) => k.name === "service_role")?.api_key;
  if (!publicKey || !serviceKey)
    throw new Error("Supabase API keys could not be resolved");

  const envs = (await vercel("/v10/projects/" + project.id + "/env")).envs;
  const previous: Record<string, string> = {};
  for (const key of [
    "DATABASE_URL",
    "PUSH_ENCRYPTION_KEY",
    "CRON_SECRET",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ]) {
    const entry = envs.find(
      (e: any) =>
        e.key === key && e.target?.includes("production") && !e.gitBranch,
    );
    if (entry) {
      const value = await vercel(
        "/v1/projects/" + project.id + "/env/" + entry.id,
      );
      if (!value.value)
        throw new Error(
          "Existing " + key + " could not be read; refusing to rotate it",
        );
      previous[key] = value.value;
    }
  }
  const adminUrl = new URL(process.env.DATABASE_URL!);
  if (
    !adminUrl.hostname.includes(ref) &&
    !adminUrl.username.endsWith("." + ref)
  )
    throw new Error("DATABASE_URL must identify the selected Supabase project");
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(846101)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY)",
    );
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      if (
        !(
          await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            version,
          ])
        ).rowCount
      )
        await c.query(
          await readFile(
            new URL(`../db/00${version}.sql`, import.meta.url),
            "utf8",
          ),
        );
    }
  });
  // A dedicated table-owning role has no access to Supabase auth/storage tables.
  // Retain its existing password on retries; never rotate stored push encryption.
  const runtimeRole = "medication_runtime";
  let runtimeUrl = previous.DATABASE_URL || process.env.RUNTIME_DATABASE_URL;
  const roleExists = (
    await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [runtimeRole])
  ).rowCount;
  if (runtimeUrl && new URL(runtimeUrl).username.split(".")[0] !== runtimeRole)
    throw new Error(
      "Existing DATABASE_URL is not the dedicated runtime role; provide a reviewed runtime migration",
    );
  if (!roleExists) {
    const password = runtimeUrl
      ? new URL(runtimeUrl).password
      : randomBytes(32).toString("base64url");
    const literal = (
      await pool.query("SELECT quote_literal($1) value", [password])
    ).rows[0].value;
    const next = new URL(adminUrl);
    next.username = adminUrl.username.includes(".")
      ? runtimeRole + "." + ref
      : runtimeRole;
    next.password = password;
    runtimeUrl ||= next.toString();
    // A failed secret write rolls back role creation. On a later retry the
    // stored credential can recreate a role after a failed commit.
    await transaction(async (c) => {
      await c.query(
        `CREATE ROLE ${runtimeRole} LOGIN NOINHERIT PASSWORD ${literal}`,
      );
      await vercel("/v10/projects/" + project.id + "/env?upsert=true", "POST", {
        key: "DATABASE_URL",
        value: runtimeUrl!,
        type: "encrypted",
        target: ["production"],
      });
    });
  }
  if (!runtimeUrl)
    throw new Error(
      "Runtime role already exists; supply RUNTIME_DATABASE_URL instead of rotating its password",
    );
  await pool.query(`GRANT ${runtimeRole} TO postgres`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
  const tables = new Set<string>();
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const sql = await readFile(
      new URL(`../db/00${version}.sql`, import.meta.url),
      "utf8",
    );
    for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g))
      tables.add(match[1]);
  }
  for (const table of tables)
    await pool.query(`ALTER TABLE public.${table} OWNER TO ${runtimeRole}`);

  const supabaseUrl = "https://" + ref + ".supabase.co";
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const bucket = "medication-photos";
  const { data: existing } = await client.storage.getBucket(bucket);
  const options = {
    public: false,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg"],
  };
  const result = existing
    ? await client.storage.updateBucket(bucket, options)
    : await client.storage.createBucket(bucket, options);
  if (result.error) throw new Error("Private photo bucket setup failed");
  await pool.query(
    "DROP POLICY IF EXISTS medication_photos_api_only ON storage.objects",
  );
  await pool.query(
    "CREATE POLICY medication_photos_api_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING(bucket_id<>'medication-photos') WITH CHECK(bucket_id<>'medication-photos')",
  );
  const template =
    "<h2>ยาของฉัน / My Medicine</h2><p>รหัสเข้าสู่ระบบ / Sign-in code: <strong>{{ .Token }}</strong></p><p>Use this code only in the app. Do not share it.</p>";
  await managed("/config/auth", "PATCH", {
    site_url: origin,
    uri_allow_list: Array.from(
      new Set([
        ...(settings.uri_allow_list || "").split(",").filter(Boolean),
        origin,
      ]),
    ).join(","),
    external_email_enabled: true,
    disable_signup: false,
    mailer_autoconfirm: false,
    mailer_templates_confirmation_content: template,
    mailer_templates_magic_link_content: template,
  });
  const vapid =
    previous.VAPID_PUBLIC_KEY && previous.VAPID_PRIVATE_KEY
      ? {
          publicKey: previous.VAPID_PUBLIC_KEY,
          privateKey: previous.VAPID_PRIVATE_KEY,
        }
      : webpush.generateVAPIDKeys();
  if (
    Boolean(previous.VAPID_PUBLIC_KEY) !== Boolean(previous.VAPID_PRIVATE_KEY)
  )
    throw new Error("Incomplete existing VAPID pair; refusing to rotate it");
  const config: Record<string, string> = {
    PUBLIC_APP_URL: origin,
    DATABASE_URL: runtimeUrl,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: publicKey,
    PRIVATE_PHOTO_BUCKET: bucket,
    LOCAL_DEMO: "false",
    NODEJS_HELPERS: "0",
    PUSH_ADAPTER: "webpush",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: previous.VAPID_SUBJECT || origin,
    PUSH_ENCRYPTION_KEY:
      previous.PUSH_ENCRYPTION_KEY || randomBytes(32).toString("base64"),
    CRON_SECRET: previous.CRON_SECRET || randomBytes(32).toString("base64url"),
    REMINDER_FRESHNESS_SECONDS: "900",
  };
  if (process.env.DATABASE_SSL_CA)
    config.DATABASE_SSL_CA = process.env.DATABASE_SSL_CA;
  const errors = productionConfigErrors({
    ...config,
    NODE_ENV: "production",
    VERCEL: "1",
  });
  if (errors.length) throw new Error(errors.join("; "));
  await vercel(
    "/v10/projects/" + project.id + "/env?upsert=true",
    "POST",
    Object.entries(config).map(([key, value]) => ({
      key,
      value,
      type: "encrypted",
      target: ["production"],
    })),
  );
  // Only store scheduler credentials in Vault; install Cron after live health
  // passes, using the separately reviewable SQL file.
  for (const [name, value] of [
    ["medication_app_url", origin],
    ["medication_cron_secret", config.CRON_SECRET],
  ]) {
    const old = (
      await pool.query("SELECT id FROM vault.secrets WHERE name=$1", [name])
    ).rows[0];
    if (old)
      await pool.query("SELECT vault.update_secret($1,$2,$3)", [
        old.id,
        value,
        name,
      ]);
    else await pool.query("SELECT vault.create_secret($1,$2)", [value, name]);
  }
  await vercel("/v9/projects/" + project.id, "PATCH", {
    rootDirectory: null,
    framework: "vite",
    nodeVersion: "24.x",
    buildCommand: "npm run build:vercel",
    outputDirectory: "dist",
    installCommand: "npm ci",
  });
  console.log("Configured selected projects. Production origin: " + origin);
  console.log(
    "Next: deploy the verified Git commit, run live checks, then apply deploy/supabase-cron.sql and check heartbeat.",
  );
} catch (error) {
  // SQL/SDK errors can contain credentials. Only our own sanitized messages
  // should be shown; database failures emit a generic retry instruction.
  if (error instanceof Error && !("code" in error))
    console.error(error.message);
  else
    console.error(
      "Database provisioning failed; inspect permissions/TLS without printing credentials.",
    );
  process.exitCode = 1;
} finally {
  await pool.end();
}
