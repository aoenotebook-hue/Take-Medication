# Medicine information

In **My medicines**, open a medicine and expand **What is this medicine used for? / ยานี้ใช้เพื่ออะไร**. Search an ingredient summary or explicitly search English product labels. Compare the ingredient/product information with the package before saving a source. The saved prescribing reason remains separate; lookup never changes medicine instructions, doses, verification status, or reminders.

## Coverage and sources

The bundled catalog contains original short Thai/English summaries for **metformin, amlodipine, atorvastatin, losartan, omeprazole, paracetamol, and cetirizine**. These describe ingredients, not a confirmed strength, route, release formulation, brand, or combination product. Only exact listed aliases match. Unknown brands and combinations are not guessed. The paracetamol source is explicitly for adults.

Each summary links its NHS source, checked on 28 October 2026. The source's revision date is shown as unknown where it was not recorded. Summaries have a fixed refresh deadline of 26 January 2027; downloading again does not extend this. Changing content requires rechecking its source and updating its version/dates. Independent clinical and native Thai review remain pending and are stated in the UI; the catalog is not presented as professionally verified.

The optional real provider uses [openFDA's label API](https://open.fda.gov/apis/drug/label/) for broader generic/brand searches. Candidate labels show ingredients, route/form text where supplied, manufacturer, country, label date and original English indications/purpose. The source is labeled English-only when no Thai summary exists. Labels are US-oriented; absence does not invalidate a Thai medicine. Listings and user selections are not claims of regulatory approval or proof of a patient's diagnosis. Returned label text is not personalized prescribing advice. Records link to the corresponding DailyMed SET ID. A separate link opens [Thai FDA patient leaflets](https://drug.fda.moph.go.th/drug-information); this is not claimed to be an integrated Thai FDA API.

External calls send only the explicit search text or a validated label SET ID. They do not send patient identity, phone, prescribing purpose, photos, regimen or token. Requests use a fixed HTTPS host, reject redirects, omit credentials, time out after six seconds, and stop at 1 MiB. Human-drug result schemas are validated, text is rendered without HTML, and response/source links are allowlisted. Authenticated search/match routes have per-actor limits. No new API key or paid service is required.

## Persistence and offline behavior

Migration 009 adds `medication_information_matches` with RLS and browser grants revoked. Saved associations contain a complete education card, confirming actor/date, and a fingerprint of the medicine's name/generic/brand/strength/form/route/product type. Changes to any identity field require a new review. The association does not change immutable regimens. Owners/editors may save; viewers may search/read. Account export includes saved associations; deleting a medicine/profile physically cascades removal of its associations.

Saved/read associations are cached in the app's private IndexedDB metadata under actor + patient + medicine. Ordinary sign-out/revocation cleanup removes them. Late responses are canceled/ignored across selection changes. Saved cached cards remain readable offline; expired cards show a refresh notice instead of current-use text. Bundled ingredient summaries also work offline without a provider request. English label cards need to have been saved/read first. Public API response caching is disabled.

## Setup and deployment

1. Install locked dependencies with `npm ci` (Node 24).
2. Back up the target database and apply **migration 009 before deploying this release**, using the authorized migration administrator: `npm run migrate` with that environment's connection injected. Alternatively run the regenerated `deploy/supabase-bootstrap.sql` in the selected Supabase SQL editor; it skips recorded migrations. Never run the synthetic seed against production.
3. If the production API uses `medication_runtime`, make it the owner of the new table, as `npm run configure:hosted` now does. An administrator can execute `ALTER TABLE public.medication_information_matches OWNER TO medication_runtime;` when that role exists. Preserve the existing API authorization/RLS architecture; do not grant browser roles access.
4. Permit backend HTTPS to `api.fda.gov`. Links open NHS, DailyMed, or Thai FDA only after the user taps them. The browser's CSP does not need additional API origins. No secret/front-end environment changes are needed.
5. Run `npm run typecheck`, `npm run check:api-build`, `npm test`, `npm run build`, and `npm run test:browser` against an isolated synthetic database. Deploy the tested code through the existing Vercel workflow.
6. Smoke-test an exact ingredient, a real English label search, saving/reopening, a stale identity, denied viewer write, provider outage and offline reopen on staging. Verify actual provider reachability and physical iPhone use before marking those checks passed.

Local unit/provider-contract/API/browser tests use synthetic data and provider fixtures. This task environment does not allow direct outbound requests to the provider or access to hosting credentials, so a live provider/deployment result is not inferred from those tests. Existing Vite chunk-size and PWA deprecation warnings remain.
