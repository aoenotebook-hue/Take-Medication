# Setup, deployment and operations

## Local development

Use Node 24 and Docker Compose. `npm ci`, copy `.env.example` to `.env`, then `npm run dev`. Docker binds only localhost PostgreSQL; the password is a local-only fixture. One owner profile is seeded, with no invented medication instructions. `LOCAL_DEMO=true` accepts only loopback requests outside production. Never use this adapter with real patient data.

Database migration: `npm run migrate`. Each migration runs under a transaction and advisory lock; a failure rolls back its schema changes and version marker. Fix a failed migration and rerun. Back up before production migration; roll forward with a reviewed migration rather than editing already applied history.

To verify a production build locally, `npm run build`, run `npm run start:api`, then use `http://localhost:3001` (set `PUBLIC_APP_URL` accordingly), or run browser tests against preview at port 4173. localhost is a secure-context exception; a phone accessing an ordinary LAN HTTP address is not. Use an owned staging HTTPS hostname for actual installation/push.

## Managed authentication, database and photos

1. Create separate development/staging/production Supabase projects in an owner-approved region. Set `SUPABASE_URL`, backend-only `SUPABASE_SERVICE_ROLE_KEY`, and a private `medication-photos` bucket. The bucket must never be public. Do not expose service credentials or PostgreSQL directly to browser clients.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are explicitly public frontend values. Configure Supabase's email template to include the one-time code `{{ .Token }}`, SMTP delivery, permitted app URLs, rate limits and expiry. Verify persistence and code delivery with test accounts. Caregivers authenticate independently.
3. Set `DATABASE_URL` to the selected PostgreSQL connection with TLS (`sslmode=require` or the host's stricter verified-CA settings). Use a dedicated backend role and private database networking. Supabase auth subject UUIDs are mapped into application users; server membership checks protect every patient operation. The app does not rely on broad Supabase public-table API grants. Revoke public/anon access to application tables and private photos; only the API/worker database role should reach them.
4. Run migrations once as a migration role, then run API/worker as restricted runtime roles. Permit necessary SELECT/INSERT/UPDATE plus sequenced IDs; DELETE is needed only for the isolated retention operator. Keep regimen/dose/audit update-denial triggers. Restrict backup access to the backup operator. Test the real runtime-role grants in staging.
5. Set `NODE_ENV=production`, `LOCAL_DEMO=false`, `PUBLIC_APP_URL=https://your-owned-host.example`. All deployment secrets belong in a secret manager; do not commit `.env`. Frontend builds receive only `VITE_` public fields.

## Web Push and devices

Generate VAPID keys once with `npx web-push generate-vapid-keys`. Store `VAPID_PUBLIC_KEY`, private `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:monitored-owner@example.com` securely. Generate a separate 32-byte base64 `PUSH_ENCRYPTION_KEY` for encrypted stored endpoints/key material. Use `PUSH_ADAPTER=webpush`. `simulated` is prohibited in production and never establishes provider acceptance or phone display.

Keep VAPID and subscription-encryption keys stable, backed up separately from database data. VAPID rotation requires unsubscribing/resubscribing affected browsers with the new application server key. Encryption-key rotation needs a controlled decrypt/re-encrypt migration before switching keys; simply replacing it makes old subscriptions unreadable. Lost keys require re-registration.

Default permitted push services are exact HTTPS hostnames for Apple, Firebase and Mozilla. Verify your actual browser endpoints. Add only reviewed provider hostnames through `PUSH_ALLOWED_HOSTS` and matching outbound host controls; never allow arbitrary hosts, IP literals or suffix wildcards. The runtime must also enforce an egress policy against private/link-local networks. Do not expose raw endpoints in logs or monitoring. Configure `REMINDER_FRESHNESS_SECONDS=900` unless the pilot explicitly changes this notification default; it is not advice about acceptable late medicine use. Snoozes (10 or 15 minutes, up to 6) are accepted until `SNOOZE_WINDOW_MINUTES` (default 60) after the dose time; each repeat gets its own 15-minute delivery window.

On the iPhone, open Safari, Share → Add to Home Screen, then reopen from the installed icon. Tap Enable reminders to feature-check and request permission. Register this device, send a test, and separately confirm whether it appeared. Permission denied/revoked needs phone settings; repeated prompts are not useful. Caregiver editing does not imply reminder consent. Device sign-out/revocation stops future eligible jobs; already accepted generic notifications cannot be recalled.

## Deploy web/API/worker

`npm ci && npm run typecheck && npm test && npm run build`. Keep the lockfile. Install/build on the same supported Node major. Prefer a VM/container host or runtime service with an **always-on API and worker**, health checks and a private PostgreSQL connection. The API serves `dist/`; put an owned HTTPS reverse proxy in front of it. Route `/api` to the same origin; do not cache authenticated responses. Serve `sw.js` and HTML with revalidation, keep assets accessible on updates, and preserve the root service-worker scope. The API's Helmet/CSP applies when it serves the site. If using a separate CDN, reproduce those headers, private response exclusions and same-origin API routing there.

Run as separately supervised processes:

```sh
NODE_ENV=production npm run start:api
NODE_ENV=production npm run start:worker
```

Configure automatic restart, bounded graceful shutdown, independent logs and secret injection. The worker polls every five seconds, refreshes a 30-day horizon daily, atomically claims leases and never sends expired work. Paid always-on hosting may be required; free static hosting or request-scoped serverless execution alone is insufficient. Development tsx is also the current production runner; deploy the exact lockfile. Provision monitoring before enabling reminders.

No deployment command was executed against a public host in this task. Use synthetic staging profiles first and complete the physical-device sheet. Real patient use requires owner approval after Thai-language, clinician/pharmacist, privacy/clinical/regulatory and supervised usability review.

## Monitoring and outages

`npm run monitor` emits only aggregate job/provider/heartbeat counts and exits nonzero on worker age >60 seconds, due-job lag >60 seconds, or horizon exhaustion within one day. Run it every minute with your host monitoring system. Alert the operator on failure, persistent 401/403 push configuration errors, 404/410 subscription churn, failed migrations, database/storage errors and failed backup/restore drills. Accepted-by-provider counts must be separate from test-seen observations. The app does not claim a notification was delivered/read or that Taken proves ingestion.

On outage, restore worker/database health; queued jobs beyond their expiry become expired rather than replaying an obsolete backlog. Inspect aggregate provider categories, never payloads. Re-enable affected devices through user-confirmed registration. Leases recover after 60 seconds; a process crash during a transport response may cause a repeated generic notification with the same stable tag.

## Backup and restore

Install PostgreSQL 17 client utilities on the operations host. Generate a distinct 32-byte base64 `BACKUP_ENCRYPTION_KEY`; store it in the secret manager, separate from backups. `DATABASE_URL` selects the source.

```sh
npm run backup
# Writes AES-256-GCM encrypted pg_dump custom-format file in backups/.
# Store the encrypted file privately off-host, verify completion, enforce 30-day expiry.
```

Back up private storage objects separately with the provider's private backup/replication tools and preserve their object keys. PostgreSQL backups include photo metadata and local-adapter bytes; production objects require that additional storage backup. Back up runtime encryption/VAPID keys and keep restore permissions restricted. Schedule daily backups, record success externally, and run a monthly restore drill. This repository does not schedule or falsely attest provider-side storage backups.

Restore only into a fresh isolated database, never over the running service:

```sh
DATABASE_URL=postgres://operator@isolated-host/restore_test \
RESTORE_CONFIRM=RESTORE_ISOLATED_DATABASE \
npm run restore -- backups/selected.dump.enc
```

Verify medication versions, dose history, allergies, memberships, audit trail, and private photo keys/objects. Run tests against synthetic restored fixtures. Disable the worker until reconciliation; restored subscriptions may need re-registration. Perform a deliberate reviewed cutover after verification. For the local Compose adapter, `BACKUP_LOCAL_DOCKER=true` uses the container's pg_dump/pg_restore. `npx tsx scripts/restore-drill.ts` creates an encrypted backup, restores a disposable database, compares medicine/dose/membership/audit/photo counts, and drops that disposable database.

## Retention and account deletion

Deletion requires authentication within five minutes and literal DELETE confirmation. It immediately tombstones owned profiles, revokes memberships/devices, cancels unsent jobs and clears browser private data. Reauthentication is performed by signing out and obtaining a new email code. Run `npm run retention` daily with a restricted retention role to purge data and private photos after 30 days. Expire backups after 30 days; deletion from already downloaded offline copies is impossible. Managed identity deletion is attempted after database tombstoning; failures remain in a durable account-deletion table and the retention operator retries them. Monitor this job, including provider failures. Local synthetic identities use a labeled adapter.

Owners should document and approve retention, backup location, incident response, user consent, and applicable privacy/clinical/regulatory obligations with qualified support. Implementation alone does not establish PDPA or medical-device compliance.
