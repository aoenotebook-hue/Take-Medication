# Improvement plan progress (Medication_PWA_Improvement_AI_Coding_Plan v1.0)

The plan reviewed an older commit (email sign-in, 5-step form). Each finding was rechecked against
the current code before changing anything. Live/physical-device checks are listed as pending, not
passed.

| Finding                                    | Status        | Notes / tests                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F01 missing production config              | Fixed earlier | Production health 200; strict startup guard kept                                                                                                                                                                                                       |
| F02 revocation undone by registration      | **Fixed**     | Background registration cannot clear `revoked_at` or re-enable an off preference; only an explicit Enable tap can. New per-patient "reminders off on this phone". Test: security "remotely revoked or turned-off device stays off" (fails without fix) |
| F03 Taken/Skipped on invalidated dose time | **Fixed**     | 409 "Occurrence replaced or stopped"; undo/resolve corrections still allowed. Test: integration "new dose records cannot attach…" (fails without fix)                                                                                                  |
| F04 async patient/account races            | **Fixed**     | Generation + account checks after every await in sync; snapshot shown only for the still-selected patient; late photo downloads dropped                                                                                                                |
| F05 one device id for all accounts         | **Fixed**     | Per-account device id (first account keeps the old id); sign-out unsubscribes the browser; offline revocation is processed only by the same account                                                                                                    |
| F06 stale photo                            | **Fixed**     | Image cleared immediately on change; late reads ignored; blob URLs revoked                                                                                                                                                                             |
| F07 export missing schedule details        | **Fixed**     | Weekdays, per-time amounts, non-Bangkok timezone, PRN dose/indication/interval/maximum. Test: summary.test.ts                                                                                                                                          |
| F08 deletion atomicity                     | **Fixed**     | `account_deletions` written in the same transaction as tombstones and PIN removal; deleted accounts lose API access (no PIN record)                                                                                                                    |
| F09 first login dead end / caregiver       | **Fixed**     | First-use screen can create a profile or accept an invitation; accepting in Settings refreshes the patient list                                                                                                                                        |
| F10 drafts not discoverable                | **Fixed**     | Drafts scoped to account+patient, autosaved, listed in My medicines with Continue/Discard. Browser test "unfinished new medicine…"                                                                                                                     |
| F11 idle screen does not refresh           | **Fixed**     | 30-second display-only clock (never sends reminders)                                                                                                                                                                                                   |
| F12 impossible snooze options              | **Fixed**     | Server publishes the freshness window; only valid choices shown, link hidden when none                                                                                                                                                                 |
| F13 double taps                            | **Fixed**     | One in-flight dose action per dose time; form save has a busy guard                                                                                                                                                                                    |
| F14 technical prompts                      | Fixed earlier | One-page form, chips, pickers, translated messages                                                                                                                                                                                                     |
| F15 auth lifecycle / sync errors           | **Fixed**     | SIGNED_OUT clears private data; 401 shows "sign in again" without deleting unsynced work; photo upload keeps HTTP status; sync no longer erases unrelated messages or overrides the chosen language                                                    |
| F16 unbounded history/export               | Partly        | Account export saved as a stream (no parse/re-stringify). Snapshot pagination deferred until real data volume needs it                                                                                                                                 |
| F17 monitor threshold                      | **Fixed**     | `WORKER_STALE_SECONDS`, default 180 s                                                                                                                                                                                                                  |
| T1.5 input bounds                          | **Fixed**     | Blank names/units rejected                                                                                                                                                                                                                             |

Pending (cannot be verified from this environment): physical iPhone Home Screen push, VoiceOver,
native Thai review, Supabase dashboard settings, and supervised patient testing.
Deferred by design (plan section 4): refill reminders, OCR, service-worker update prompt, snapshot
pagination.

## Requested addition: medicine information

**First implementation available locally.** Medicine details include seven sourced Thai/English
ingredient summaries, optional real openFDA English label lookup, source comparison, separate
prescribing purpose, authorized saved associations, identity-change review and private offline
caching. Prescription fields are unchanged. Migration 009 is required before deployment.

See [feature/setup documentation](drug-information.md) and
[the AI coding plan addendum](Medication_PWA_Drug_Information_AI_Coding_Plan.txt).
Clinical/native Thai review, live provider reachability, production migration/deployment and
physical iPhone validation remain pending. English labels are not automatically translated.
