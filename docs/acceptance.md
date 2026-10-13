# Verification record

Latest application/hosting regression run: **13 October 2026 (UTC)** using Node 24, PostgreSQL 17 in an isolated local Docker container, and installed Linux Chromium. The backup/PDF visual drills below were performed on 12 October. Synthetic records only. This is an implementation verification record, not a clinical or production certification.

## Automated results

Final commands and counts are recorded below after the final regression run. Tests are not treated as exhaustive acceptance of the entire specification.

- `npm run migrate`: transactional numbered migrations applied successfully; repeated invocation is safe.
- `npm run typecheck`: TypeScript check passed.
- `npm test`: **50 tests passed** (recurrence/quantities/status, real PostgreSQL transactions/worker/authorization, HTTP security, bounded serverless horizon/lease recovery, distributed rate counters, RLS browser isolation, public-key alias/secret rejection and 1/10/30-medicine Thai PDFs).
- `npm run check:api-build`: emitted production API loaded with plain Node, synthetic production configuration and no network calls. The local Vercel function builder also packaged and loaded the API; explicit file extensions, Node-only type configuration and response-streaming metadata were verified.
- `npm run build`: installable build and service-worker precache generated. Vite reports large PDF/application chunks; they are included in the offline cache.
- `npm run test:browser`: **3 tests passed** (Thai navigation/axe, cached offline cold-open, sign-out cache purge, guided manual entry, offline mutation replay, large-photo offline compression/upload, offline PDF download, 200% layout).
- Vercel build guard rejected a synthetic private frontend key; a build using a standard public-key integration alias passed. The latest local browser run used a 90-second overall test budget after timeouts on a busy runner; all assertions were retained and all three cases passed. CI retains its standard time budget.
- The owner-provided Vercel log confirmed missing frontend public-key configuration. The owner added both production variables. Secure provider access and direct public-host access are still unavailable in this task environment, so authenticated live checks and remote provisioning remain unrun.
- `npx tsx scripts/restore-drill.ts`: encrypted custom-format PostgreSQL backup restored into a temporary isolated database; medication, dose-event, membership, audit and photo counts matched. The temporary restore database was removed.
- Official MDN source documentation was read for Push API and notification-click lifetime/routing behavior. The OFL Thai font license is bundled.

## Acceptance coverage

| Specification group | Evidence run                                                                                                                                                                                                       | Remaining manual/live checks                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| A Entry             | Decimal/rational quantities remain distinct from original strengths; manual entry without photo; differing times/amounts; reference and PRN suppress recurrence                                                    | Physical camera, HEIC handling and pharmacist transcription review                                                |
| B Changes           | Immutable versions, expected-version conflicts, future history preservation, stop invalidation, idempotent operations                                                                                              | Supervised label correction and pause/resume workflows                                                            |
| C Schedules         | Selected weekdays, inclusive end, Bangkok, midnight/year boundary, changed timezone, DST gap/earliest-overlap policy                                                                                               | Actual non-Bangkok DST device workflow (server horizon isolation is automated)                                    |
| D Doses             | Double-tap idempotency, append-only correction/undo, backdate confirmation/future-record rejection, independent device conflict and explicit resolution, PRN separate events, bounded snoozes, no missed inference | Actual multi-phone assistance and backdated UI usability                                                          |
| E Physical push     | Server queue/worker logic and generic payload tests                                                                                                                                                                | **All physical iPhone scenarios unrun**; see device sheet                                                         |
| F Staleness         | Expired work does not send, Retry-After bounded by expiry, current occurrence validity/status checked before send, generic messages, offline warning                                                               | Old accepted push after real device schedule change                                                               |
| G Deduplication     | Concurrent schedulers/workers, unique jobs, lease recovery, stable-tag code                                                                                                                                        | Real transport ambiguity observation                                                                              |
| H Offline           | Cached cold-open, Thai shell/PDF assets, offline medicine mutation queue and ordered reconnect, sign-out clearing                                                                                                  | Quota/storage eviction, actual iPhone account switch, offline dose/photo flow on a device                         |
| I Authorization     | Outsider tampering, viewer/editor limits, revoked membership, reused/expired/email-bound invite, stolen endpoint denial, origin checks, unsupported/valid uploads and private photo export                         | Real managed-provider/storage grants and caregiver revocation across physical phones                              |
| J OPD               | Same snapshot projection, offline PDF download, embedded Thai font, generated 1/10/30 medication PDFs with pagination                                                                                              | Native Thai rendered review and clinician reconciliation                                                          |
| K Accessibility     | axe on doctor view, three labeled tabs, narrow 390px and 200% text check, native dialog/focus and target styles                                                                                                    | VoiceOver, Thai literacy/usability, landscape and actual safe-area testing                                        |
| L Operations        | Real DB, migration rollback, leases, subscription encryption/tamper checks, 410 disable, encrypted backup/restore                                                                                                  | External monitoring, production object backup, live secret rotation, production retention/purge and restore drill |

The automated browser PDF and 30-medicine synthetic PDF were rendered and visually inspected for font presence/wrapping/page layout. This visual inspection does not replace a native Thai-language reviewer.

## Milestones

M1–M5 implementation is present and exercised by the automated checks above. External-credential and physical-device exit conditions of M4 remain pending. M6's source verification and runbook are supplied; native Thai, clinician/pharmacist and supervised older-adult pilot reviews have **not been run**. Public launch is a separate owner decision after these gates.

Production dependency audit (`npm audit --omit=dev`) reported **0 known vulnerabilities** on this run. This is a dependency database result, not a penetration-test claim.
