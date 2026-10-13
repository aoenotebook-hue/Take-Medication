# Physical-iPhone acceptance sheet — NOT RUN

No physical iPhone was available in this environment. Chromium automation is not evidence of iOS push behavior. Fill in observed results before enabling real patient reminders.

Tester/date: ___ · Device: ___ · iOS version: ___ · App build/commit: ___
Staging HTTPS origin: ___ · API/worker version: ___ · VAPID key identifier: ___
Test accounts/profiles: synthetic only. Never paste endpoints, auth keys or health details into logs.

| Scenario                          | Steps / observation required                                                                                            | Result |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| Fresh installation                | Safari Share → Add to Home Screen; reopen icon; document wording on the tested iOS version                              | Unrun  |
| Capability detection              | Installed/noninstalled/unsupported browser; usable medicine/doctor views remain accessible                              | Unrun  |
| Permission                        | Explicit Enable tap; granted, denied, then revoked in settings; no repeated permission prompts                          | Unrun  |
| Registration and consent          | Device listed; opt-in is separate for each caregiver/patient; replacement and remote revoke                             | Unrun  |
| Test notification                 | Queue a test, record provider acceptance separately, ask whether user saw it, save explicit confirmation                | Unrun  |
| App closed                        | Close PWA, schedule synthetic occurrence, observe generic notification and tap to current authenticated state           | Unrun  |
| Locked phone                      | Observe generic lock-screen text only; record actual OS display time separately from dispatch                           | Unrun  |
| Focus / silent                    | Turn on Focus and silent mode; document observed presentation; never assert bypass or alarm guarantees                  | Unrun  |
| Network outage                    | Disconnect across due time; reconnect after expiry; no obsolete dose instruction or take-now backlog                    | Unrun  |
| Worker restart                    | Restart before/after claim; recover lease; stable tags; acknowledge rare ambiguous-send duplicate possibility           | Unrun  |
| Subscription expired              | Test 404/410 response in staging; disabled device and useful re-registration guidance                                   | Unrun  |
| Accepted old push                 | Change/stop medicine after provider acceptance; old generic notification opens reconciled current instructions          | Unrun  |
| Offline dose/edit/stop            | Read cached photos/medicines/summary; queue writes; clear warning that server may retain old instructions               | Unrun  |
| Cold-open offline                 | Previously installed and cached app opens without an API; inspect Thai assets and actual load time                      | Unrun  |
| Offline PDF                       | Export locally after cached assets; share/download through user-selected OS flow; inspect 1/10/30 medicines             | Unrun  |
| Quota / storage eviction          | Fill storage or clear website data; understandable storage failure and authenticated recovery; no false synced badge    | Unrun  |
| Offline sign-out                  | Warning about pending binding removal; private app caches cleared; generic notification limitation stated               | Unrun  |
| Account switch / caregiver revoke | Same browser switches accounts; no cross-profile cache; revoked server access blocks and purges next sync               | Unrun  |
| VoiceOver                         | Patient identity, tab labels, photos, exact times, taken/skip/snooze actions, modal focus, history and conflicts        | Unrun  |
| Display/accessibility             | 200% text, narrow portrait/landscape, Thai wrapping/numerals, reduced motion, safe areas and contrast                   | Unrun  |
| Label/summary review              | Native Thai and pharmacist/clinician reconcile entered strength, administration amount, route and original instructions | Unrun  |
| Usability pilot                   | Supervised older adults find next schedule and doctor list; record actual error/task-time observations                  | Unrun  |

## Supported-device matrix

| Device/browser           | Version                                           | Actual testing                     | Support claim                                               |
| ------------------------ | ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Linux Chromium           | Installed system Chromium used by automated tests | Browser/offline/PDF/axe checks run | Development browser verification only                       |
| iPhone Home Screen PWA   | iOS/iPadOS 16.4+ platform prerequisite            | Not run                            | Intended target; acceptance pending                         |
| Safari browser tab       | Actual selected iOS versions                      | Not run                            | Setup/review target; push requires Home Screen installation |
| Other browsers / Android | Feature-detected                                  | Not run                            | No tested-device guarantee                                  |

Pilot targets from the specification are **unmeasured**: 90% uncoached task success, no unresolved critical transcription errors, cached Today within two seconds on selected phone, normal worker dispatch starts within 60 seconds. Dispatch and OS display latency are distinct measurements.
