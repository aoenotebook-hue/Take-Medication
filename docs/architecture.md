# Architecture

Browser → same-origin authenticated API → PostgreSQL/private photo storage. Separate worker generates 30-day occurrences, creates uniquely keyed reminder jobs, claims them with PostgreSQL leases, rechecks authorization and current dose/regimen validity, and sends generic Web Push messages. Notifications open an authenticated current-state app, with no medicine instruction in their URL or payload.

## Components

- `apps/web`: React/Vite, Thai/English primary navigation, 20px body, adjustable text, keyboard/native modal dialogs, 56px buttons, three tabs. Photos zoom in a separate blob view. No runtime CDN font or icon requirement.
- `apps/api`: Express, Zod, Supabase Auth `getUser` verification, bearer sessions, same-origin mutation checks, Helmet/CSP, request rate limits. Actor and role come from verified server state. Private photo bytes are served through an authorized, no-store endpoint. Photos are rotated, resized and EXIF-stripped by Sharp.
- `packages/domain`: shared quantity schemas, IANA/Luxon recurrence, deterministic UUIDv5 occurrences, inclusive end dates, one occurrence for DST overlaps (earliest UTC), DST-gap errors, event conflict/undo projection. Decimal and rational instructions stay as strings; no unit conversion or concentration math.
- `db`: numbered transactional migrations, indexes, immutable-row update guards, synthetic seed. PostgreSQL canonical data and append-only dose/audit/regimen content. Future-version supersession metadata is a separate table; original content is retained.
- `apps/worker`: independent always-on process; short polling is server-side work, never a phone reminder timer. Daily horizon refresh, unique aggregated jobs, `SKIP LOCKED` claims, recoverable leases, retry/freshness/invalid-subscription handling. Stable notification tags reduce ambiguous-send duplicate displays; exactly-once transport is not claimed.

## Deliberate adaptations

The directories share a root dependency manifest and exact lockfile, rather than separate workspace package manifests. The specification's API routes are an outline. Mutations use one typed `/api/sync/push` handler instead of separate direct-write medication/regimen/profile endpoints. It accepts ordered operations, returns per-operation acknowledgement/conflict/rejection and stores idempotent results under server actor + operation UUID. Patient snapshots provide the read model; incremental authorized cursors tell clients what changed. Pulls currently fetch a bounded occurrence window and complete patient medication/event records. This favors consistency over delta-payload optimization.

Regimens embed validated schedule slots in immutable JSONB rather than a separate slot table. Slots have stable UUID IDs, structured quantities, local times and weekdays; occurrences retain these identifiers. Future-effective versions can be superseded without modifying historical versions. New changes cannot rewrite historical instructions. Medication identity corrections require explicit same-medicine confirmation; a different product belongs in a new record.

Private Supabase Storage is used when configured. The local synthetic adapter keeps photo bytes in PostgreSQL; it cannot activate in production. Subscriptions are AES-256-GCM encrypted when configured; production requires the encryption key. Development explicitly labels unencrypted local subscription storage and simulated sends.

PDFMake uses an embedded OFL Noto Sans Thai font and its fontkit shaping pipeline. PDF assets are precached; exports are generated locally from the same snapshot shown on screen. A download is the current file-sharing fallback; users choose their own OS sharing destination. Thai PDF rendering needs human native-language review.

## Offline and conflict rules

IndexedDB stores actor-scoped snapshots, local drafts, photos, operation outbox and font data. The service worker caches only public app-shell assets; APIs and exported PDFs have no shared HTTP cache. Account switch/sign-out clears private IndexedDB data. Browser-local data are not advertised as encrypted.

Operations include UUID, patient/resource, base version, client time and browser device UUID. Server authorization occurs before idempotent replay. Writes queue while disconnected; scheduled instructions in Today remain last server-confirmed with a prominent pending-reminder warning. Medicine details show pending local planned instructions. Independent dose records become conflicts rather than two administrations. Rejected/conflicting operations remain visible; conflicted regimen updates freeze until the user discards or explicitly reviews/rebases them. Photos have stable UUID upload keys for replay after network ambiguity.

Synchronization runs on launch, visibility resume, online transition and explicit retry, and never claims acknowledgement based only on a browser network flag. Revoked access purges app-managed local data at the next authorized contact; previously downloaded offline copies cannot be remotely recalled. Offline sign-out stores a nonsensitive pending device-revocation ID, clears private data, and warns generic notifications can continue until remote revocation.

## Platform documentation

Implementation checked official MDN source documentation on 12 October 2026 for server-originated Push API messages, active worker subscriptions, visible notifications, `event.waitUntil`, focus/open routing, and CSRF protection. Sources: [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [notificationclick](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event). The supplied WebKit/Apple references and iOS 16.4 Home Screen constraints are retained in the device checklist. No actual iPhone observation is inferred from Chromium. Platform-specific presentation/TTL requirements must be reconfirmed in staging on the selected supported iOS versions.

Later features (OCR, escalation, refill estimates, tapers, imports, clinician links) have no active UI/API and remain disabled. No pill identification, automatic late-dose recommendations or interaction checking is implemented.
