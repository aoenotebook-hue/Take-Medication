# GitHub publication and full-stack deployment

The repository is the source/deployment distribution target. GitHub Pages cannot run this app's PostgreSQL API or its independent always-on reminder worker. Publishing an image is not the same as hosting a running medication app.

## Automated checks and image

The `Verification` workflow runs the recurrence/domain, real PostgreSQL/security/PDF and browser checks. Once a push to `main` passes, `Publish deployment image` builds the verified commit and publishes `ghcr.io/aoenotebook-hue/take-medication:sha-COMMIT_SHA` plus `latest`. Prefer the immutable SHA tag for deployment and rollback. Container publication remains subject to repository Actions/package permissions.

Set repository **Variables** `SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the frontend before building a runnable image. They must be explicitly public Supabase URL/publishable credentials. Never use the service-role credential as the frontend key. An image built without frontend authentication configuration remains an artifact and is rejected by production startup, rather than serving a falsely functioning login.

## Deployment host

Supply a Linux Docker/Compose host and an owned domain pointing to it, plus PostgreSQL and the managed Supabase Auth/private-photo project. Docker images do not create those external services. No real patient information is included in the source or image.

1. Clone this repository on the host. Copy `.env.production.example` to `.env.production`, restrict it to the deployment operator, and supply actual values through the host's secret manager. Do not commit the populated file. Configure the Supabase email-code template and a private photo bucket as described in the main runbook.
2. Use a least-privilege PostgreSQL runtime role. Run the migration service with a separate migration-role `DATABASE_URL` if the runtime role cannot create schema objects.
3. Set `APP_DOMAIN`, `ACME_EMAIL` and matching `PUBLIC_APP_URL=https://your-domain`. Open only 80/443 publicly; PostgreSQL/API/worker ports are not published by this Compose bundle.
4. Build with public authentication values and run configuration/migrations before starting the gateway:

   ```sh
   docker compose --env-file .env.production -f compose.production.yml build
   docker compose --env-file .env.production -f compose.production.yml run --rm migrate
   docker compose --env-file .env.production -f compose.production.yml up -d --wait
   ```

   Alternatively, authenticate the operator to GHCR if the package is private, set `APP_IMAGE` to the verified immutable image tag, and `pull` instead of `build`. Public authentication values are baked into the frontend; changing them requires rebuilding.

5. Check the actual site:

   ```sh
   curl --fail https://your-domain/api/health
   docker compose --env-file .env.production -f compose.production.yml exec api node scripts/container-health.mjs api
   docker compose --env-file .env.production -f compose.production.yml exec worker node scripts/container-health.mjs worker
   docker compose --env-file .env.production -f compose.production.yml exec worker node --import tsx scripts/monitor.ts
   ```

   Check the root HTML, manifest and `sw.js`, unauthenticated API rejection, email-code sign-in with a synthetic account, profile isolation, medicine create/edit/stop, offline reconnect/PDF, private photos and explicit test push confirmation. Record physical-iPhone results using the device sheet; a generic health response does not establish these outcomes.

Caddy supplies HTTPS and forwards exactly one trusted proxy hop; API and worker run without root, with a read-only filesystem, restricted capabilities, bounded logs and health probes. Supervise the Compose host and configure backups, provider-egress restrictions and operational alerting. Runtime health does not prove managed login, live push display, backup success or regulatory/clinical readiness.

## Rollback

Keep the prior immutable image tag. Review migration compatibility before rollback; do not downgrade a changed database blindly. Back up first and use a forward repair migration when necessary. Update `APP_IMAGE`, pull it, and recreate API/worker once compatibility is established. Preserve VAPID/encryption keys and the private database/storage data.
