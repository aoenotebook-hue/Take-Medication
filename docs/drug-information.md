# Medicine information

In **My medicines**, open a medicine and expand **What is this medicine used for? / ยานี้ใช้เพื่ออะไร**. Search an ingredient summary or explicitly search English product labels. Compare the ingredient/product information with the package before saving a source. The saved prescribing reason remains separate; lookup never changes medicine instructions, doses, verification status, or reminders.

## Coverage and sources

The bundled catalog contains 17 original short Thai/English summaries: **metformin, amlodipine, atorvastatin, losartan, omeprazole, paracetamol, cetirizine, enalapril, atenolol, bisoprolol, simvastatin, gliclazide, allopurinol, amoxicillin, furosemide, clopidogrel, and levothyroxine**. These describe ingredients, not a confirmed strength, route, release formulation, brand, or combination product. Only exact listed aliases match. Unknown brands and combinations are not guessed. The paracetamol source is explicitly for adults.

Each summary links its NHS source, checked on 28 October 2026. The source's revision date is shown as unknown where it was not recorded. Summaries have a fixed refresh deadline of 26 January 2027; downloading again does not extend this. Changing content requires rechecking its source and updating its version/dates. Independent clinical and native Thai review remain pending and are stated in the UI; the catalog is not presented as professionally verified.

The optional real provider uses [openFDA's label API](https://open.fda.gov/apis/drug/label/) for broader generic/brand searches. Candidate labels show ingredients, route/form text where supplied, manufacturer, country, label date and original English indications/purpose. The source is labeled English-only when no Thai summary exists. Labels are US-oriented; absence does not invalidate a Thai medicine. Listings and user selections are not claims of regulatory approval or proof of a patient's diagnosis. Returned label text is not personalized prescribing advice. Records link to the corresponding DailyMed SET ID. A separate link opens [Thai FDA patient leaflets](https://drug.fda.moph.go.th/drug-information); this is not claimed to be an integrated Thai FDA API.

External calls send only the explicit search text or a validated label SET ID. They do not send patient identity, phone, prescribing purpose, photos, regimen or token. Requests use a fixed HTTPS host, reject redirects, omit credentials, time out after six seconds, and stop at 1 MiB. Human-drug result schemas are validated, text is rendered without HTML, and response/source links are allowlisted. Authenticated search/match routes have per-actor limits. No new API key or paid service is required.

## Persistence and offline behavior

Migration 009 adds `medication_information_matches` with RLS and browser grants revoked. Saved associations contain a complete education card, confirming actor/date, and a fingerprint of the medicine's name/generic/brand/strength/form/route/product type. Changes to any identity field require a new review. The association does not change immutable regimens. Owners/editors may save; viewers may search/read. Account export includes saved associations; deleting a medicine/profile physically cascades removal of its associations.

Saved/read associations are cached in the app's private IndexedDB metadata under actor + patient + medicine. Ordinary sign-out/revocation cleanup removes them. Late responses are canceled/ignored across selection changes. Saved cached cards remain readable offline; expired cards show a refresh notice instead of current-use text. Bundled ingredient summaries also work offline without a provider request. English label cards need to have been saved/read first. Public API response caching is disabled.

## Setup and deployment

1. Install locked dependencies with `npm ci` (Node 24).
2. Back up the target database and apply **migrations through 010 before deploying this release**, using the authorized migration administrator: `npm run migrate` with that environment's connection injected. Alternatively run the regenerated `deploy/supabase-bootstrap.sql` in the selected Supabase SQL editor; it skips recorded migrations. Never run the synthetic seed against production.
3. If the production API uses `medication_runtime`, make it the owner of the new tables, as `npm run configure:hosted` now does. An administrator can execute `ALTER TABLE public.medication_information_matches OWNER TO medication_runtime;` when that role exists. Also assign `medication_information_automatic` to that runtime owner. Preserve the existing API authorization/RLS architecture; do not grant browser roles access.
4. Permit backend HTTPS to `api.fda.gov` and `rxnav.nlm.nih.gov`. Links open NHS, DailyMed, or Thai FDA only after the user taps them. The browser's CSP does not need additional API origins. No secret/front-end environment changes are needed.
5. Run `npm run typecheck`, `npm run check:api-build`, `npm test`, `npm run build`, and `npm run test:browser` against an isolated synthetic database. Deploy the tested code through the existing Vercel workflow.
6. Smoke-test an exact ingredient, a real English label search, saving/reopening, a stale identity, denied viewer write, provider outage and offline reopen on staging. Verify actual provider reachability and physical iPhone use before marking those checks passed.

Local unit/provider-contract/API/browser tests use synthetic data and provider fixtures. This task environment does not allow direct outbound requests to the provider or access to hosting credentials, so a live provider/deployment result is not inferred from those tests. Existing Vite chunk-size and PWA deprecation warnings remain.

## Automatic lookup and short descriptions

Saved medicines immediately use an exact ingredient/alias match from the bundled catalog. Unrecognized drug names are resolved using NLM RxNorm exact identity search (`search=0`) and a single ingredient relation. Ambiguous names, combination products, supplements, and ingredients outside this catalog remain unresolved; no use is invented. Only the medicine name or generic/brand text leaves the backend, never the patient, dose, recorded reason, or credentials. The fixed HTTPS service has a five-second deadline, 128 KiB response cap, schema validation, redirect rejection, and no credentials. Settings → Privacy and data can disable external automatic lookup; bundled/offline summaries remain available.

Migration 010 stores private automatic associations, fingerprints, and retry times separately from manually confirmed matches. Requests process at most two medicines, and the reminder worker refreshes one eligible medicine within its deadline. Claims prevent duplicate concurrent lookups; negative results and outages back off. Identity edits invalidate cached matches. Automatic matches are ingredient education, never a confirmed diagnosis or prescribing reason.

My medicines, in-app alerts, web push details, and calendar alarm descriptions display the short use on a separate line. The name-hiding setting suppresses both names and uses. Existing imported calendar events must be replaced to receive new descriptions or privacy changes. Device calendar software controls which alarm fields it displays. Source expiration also suppresses current-use text. Saved personal reasons remain labeled separately and are never overwritten.

## Monthly report and Settings

Open Monthly report from My medicines or Settings. The patient-timezone table counts valid scheduled occurrences already due in the selected month, using server-confirmed events and their corrections. It shows doses due, taken count/percentage, skipped count, no-record count, and the percentage skipped or without a record. Conflicting records are shown separately and require review. The denominator excludes future and replaced occurrences. Zero-dose months show a dash for percentages. As-needed use has a separate count and no adherence percentage. Reports cover schedules recorded by this app, not a reconstructed history from before tracking began. A missing record is not proof of a missed dose.

Reports are cached privately by actor, patient and month for offline reading, with generation time and saved-copy status. Unsynced phone events are explicitly flagged. Settings keeps sync, report access and sign-out visible, and groups display, reminders, caregivers, privacy, reset and account controls into labeled expandable sections.

Security review: the new table has RLS enabled and no browser grants/policies, intentionally restricting access to the authorized backend. Existing database tables follow this design. Supabase also reports the pre-existing disabled leaked-password protection advisory; this release preserves the current phone/PIN authentication model. See [Supabase password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) for account-policy administration.
