# Vercel + Supabase hosting

Selected projects:

- Vercel: https://vercel.com/aoe5/take-medication
- Supabase: https://supabase.com/dashboard/project/qfiplelamyjwvexosmii
- Source: https://github.com/aoenotebook-hue/Take-Medication

The PWA is served from Vercel's CDN. `api/index.ts` exports the Express API as a 60-second Node function. Supabase provides verified authentication, PostgreSQL and a private photo bucket. Supabase Cron calls a protected Vercel reminder endpoint every minute, and a retention endpoint every 15 minutes. No continuous worker process or Vercel Hobby Cron is required for this hosting option. Do not also run the container worker against this database.

## Secure access

Dashboard links do not grant deployment access. Configure `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN` and the selected project's administrator `DATABASE_URL` in the task environment's secret manager. The Vercel token must manage the `aoe5/take-medication` project; the Supabase token must read its API keys/auth settings and update auth configuration. The database administrator must migrate app tables, create the dedicated runtime role, manage storage policies, use Vault and enable `pg_cron`/`pg_net`.

Allow HTTPS to `api.vercel.com`, `api.supabase.com`, `qfiplelamyjwvexosmii.supabase.co`, the actual production app domain, and normal package/GitHub build destinations. Allow PostgreSQL TCP to the exact pooler hostname and port from Supabase's **Connect** panel. Retain the environment proxy and CA trust. Do not bypass a denied destination or turn off TLS verification. Optional `DATABASE_SSL_CA` holds the trusted PEM CA for the selected database.

The Vercel and Supabase plugins in this session were disabled by the workspace administrator. No provider credentials were configured during preparation. This document and the deployment scripts are prepared; remote provisioning, actual email delivery and live runtime behavior have not been verified.

## Configure

Use Supabase Auth's SMTP settings to configure a working mail provider. Supabase's default mail service restricts recipients and is unsuitable for public email-code sign-in. The provisioning script requires custom SMTP and preserves its credentials. Send a code to a mailbox you control and check receipt after deployment; an administrator-created synthetic auth account does not verify email delivery.

Ensure the selected Vercel project is connected to the source repository. Root directory is the repository root, framework Vite, Node 24, install `npm ci`, build `npm run build:vercel`, output `dist`. `vercel.json` supplies routing, security/cache headers and function duration. The Content Security Policy is scoped to the selected Supabase project; update it if changing projects.

With secrets injected into the process environment:

```sh
npm ci
npm run configure:hosted
```

Alternatively copy `.env.hosted.example` to the ignored `.env.hosted`, populate it securely, set file permissions to `600`, and run:

```sh
node --env-file=.env.hosted --import tsx scripts/configure-hosted.ts
```

In a managed environment that requires Node's proxy handling, add `NODE_USE_ENV_PROXY=1` and the provided public CA with `NODE_EXTRA_CA_CERTS="$CODEX_PROXY_CERT"`; keep inherited proxy variables. Network policy still applies.

Configuration performs these operations:

1. Verify the exact Vercel repository connection, discover a production domain, and inspect SMTP readiness.
2. Apply transactional migrations 001–007. App tables have RLS without browser policies and explicit browser-role privilege revocation. Create a dedicated `medication_runtime` table-owning role; retain the administrator connection only in the provisioning environment. Vercel gets the dedicated role's pooled connection. On retries, existing runtime credentials and push/encryption keys are retained. If a role already exists without stored credentials, supply `RUNTIME_DATABASE_URL`; its password is never silently reset.
3. Create or update the private `medication-photos` bucket. A restrictive storage policy excludes this bucket from all browser-role object access, including broad policies for other buckets. Only the authenticated app API accesses its objects with the backend service credential.
4. Set the production origin, confirmation/sign-in email templates displaying `{{ .Token }}`, and enable email sign-up. Preserve existing SMTP settings and allowed redirects.
5. Set production Vercel environment variables. Public frontend values are only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; backend service/DB/VAPID/private encryption/cron credentials never enter the web bundle. Store the scheduler URL and token in Supabase Vault. Cron installation waits until live checks pass.

The build rejects absent or privileged frontend keys. Runtime startup rejects missing secrets, synthetic authentication and simulated push. Local photo inputs accept JPEG/PNG/WebP up to 8 MB, then strip metadata and compress below 2 MB before entering the offline queue. The API independently validates/re-encodes images and enforces the same upload limit. Account JSON exports stream records and individual photos instead of buffering all photos together; very large account histories still need pagination and scale testing.

## Deploy and check

Use an exact source commit whose **Verification** workflow passed. Put its full SHA in `DEPLOY_COMMIT`; do not use a moving branch name.

```sh
npm run deploy:hosted
# Or, with the ignored environment file:
node --env-file=.env.hosted --import tsx scripts/deploy-hosted.ts
```

The script creates a production deployment from that SHA, waits for Vercel readiness, then runs a synthetic live check. It verifies PWA assets, PostgreSQL health, production demo rejection, unauthenticated and cross-patient access rejection, managed sign-in with the public key, idempotent medication writes, private photos, direct database/storage access denial, streamed account export and account deletion. The temporary identity is removed; its tombstoned synthetic profile follows the configured retention job. No existing patient account is used for these tests.

Only after those checks pass does it apply `deploy/supabase-cron.sql`. It verifies a manual reminder invocation and waits for a later database heartbeat proving automatic Cron invocation. Inspect `cron.job_run_details` and `net._http_response` when Cron runs but HTTP fails: Cron SQL success alone does not prove the HTTP function ran. Ensure the production URL accepts requests from Supabase; do not point Cron at a deployment-protected preview URL. The script does not disable project access protections.

To rerun only the live synthetic check, provide `PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_ANON_KEY`, then run `npm run check:live`. It intentionally creates and deletes its own synthetic account and profile.

## Operations

Reminder runs use a persistent 2-minute invocation lease, atomic job leases, bounded work, current device/membership/dose checks, expiry and retry rules. Rolling horizons refresh in batches. Rate limits are shared in PostgreSQL across cold starts. A one-minute scheduler cadence, network/platform availability, device state and user permissions affect timing; no exact-time or exactly-once notification claim is made.

Monitor worker heartbeat with a threshold appropriate to the one-minute cadence (at least 3 minutes), queue age/expiry, schedule issues, SQL/HTTP Cron outcomes, API errors and SMTP delivery. The retention endpoint processes one eligible profile per invocation; monitor its backlog and increase batch/cadence as account volume grows. Configure and drill database and private-object backups separately; provider hosting does not establish a complete backup/restore policy.

Check actual email-code sign-in and a real Home Screen install on an iPhone. Enable notifications, request a test reminder, confirm display/open behavior, log a dose, change a regimen, check offline recovery, revoke a device and test export. The automated checks do not prove physical notification display, Focus/locked-screen behavior, clinical review or Thai usability. See `iphone-checklist.md` and `known-issues.md` for those remaining checks.

Provider references: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [pool lifecycle](https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute), [function payload limits](https://vercel.com/docs/functions/limitations), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Cron](https://supabase.com/docs/guides/cron), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
