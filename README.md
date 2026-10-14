# My Medicine · ยาของฉัน

A Thai-first medication organizer for patients and invited caregivers. React PWA, authenticated Node API, PostgreSQL, private photos, offline outbox, and an independent durable Web Push worker. Instructions are entered from the original prescription or advice; the app does not prescribe or decide whether a late dose is safe.

## Run locally

Requires Node.js 24, npm and Docker Compose. All bundled data are synthetic; local demo authentication is explicitly separated from managed sign-in.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**, choose **ทดลองด้วยข้อมูลสมมติ / Try synthetic demo**. The dev command starts PostgreSQL, migrates, seeds an empty synthetic profile, and runs web/API/worker. No medicine or dose defaults are fabricated. Add a medicine from your synthetic test instructions. Set `PUSH_ADAPTER=simulated` only for CI/local queue inspection; it does not display notifications. The default real adapter requires VAPID configuration.

```sh
npm run migrate        # transactional, advisory-locked migrations
npm run seed           # synthetic profile; prohibited in production
npm run verify         # full suite, against the local synthetic/test database
npm run typecheck
npm test               # recurrence + real PostgreSQL + HTTP security
npm run build          # installable offline production app -> dist/
npm run test:browser   # built app, Chromium offline/PDF/accessibility checks
```

If Chromium is absent: `npx playwright install --with-deps chromium`. Optionally set `CHROMIUM_PATH` to an installed Chromium executable. Test databases must be isolated from patient data; tests insert synthetic records. For development device installation, test the **built** app over staging HTTPS, not Vite's development server (service worker is intentionally enabled in production builds).

## Setup and deployment

For the repository-to-container workflow, see [GitHub and container deployment](docs/github-deployment.md).

For the selected Vercel and Supabase projects, see [Vercel + Supabase setup, deployment and live checks](docs/vercel-supabase.md). This option runs reminders through Supabase Cron and a bounded Vercel function.

Follow [the deployment and operations runbook](docs/runbook.md) for Supabase email codes, database/storage isolation, HTTPS, VAPID, worker supervision, backups and restore. The API can serve `dist/` behind an HTTPS reverse proxy; a static frontend alone cannot schedule reminders.

- [Architecture and specification adaptations](docs/architecture.md)
- [OpenAPI contract](docs/openapi.json)
- [Verification results and remaining gates](docs/acceptance.md)
- [Physical-iPhone test sheet](docs/iphone-checklist.md)
- [Known limitations](docs/known-issues.md)
- [Original build specification](docs/specification.txt)

Physical iPhone delivery, managed-provider credentials, native Thai-language review, clinician/pharmacist reconciliation and supervised patient usability are separate release gates. The source and automated checks do not establish clinical validation or legal compliance. No public deployment was performed.
