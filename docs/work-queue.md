# Work queue — branch `fix/post-merge-followups` (PR #202, draft)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`. Freshness rule and
kept twins (`vehicle-twin`, `digital-twin-mini`) apply to every part.

Last updated: 2026-10-22 by Muse (Track A budget+i18n fix pushed; Track B
Phase 1 reviewed; two full-suite runs reconciled).
Branch HEAD: `94b2f4a62a` (pushed). Next: TZ-5 277-route sweep, TZ-6 re-run,
TZ-7 full local replica + PR green. Codex CLIs and vite :3000 were left
untouched as possible user tooling.

## Parts overview

| Part | Name | Status | Last commit / note | Next step |
|---|---|---|---|---|
| 1 | Time zone: follow setting everywhere, remove duplicates — TRACK A (`fix/post-merge-followups`) | in progress | TZ-5c done; wip fixed by a09dc6ec15; freshness correction b7c55d6ab2+b3f0ba6272+658e6563fc; startup-budget fix (this change, unpushed) | TZ-5 277-route sweep, TZ-6 re-run, TZ-7 replica + push + PR #202 green. Only Track A commits here until done |
| 2 | Dashboard widget redesign (119 widgets) — TRACK B (`feat/widget-redesign` in `~/repos/teslasync-widgets`) | in progress | Phase 3 recovered/reconciled: 119/119 widget coverage; Track B pushed to origin; Phase 4 started. Latest run reported 58 failed suites / 71 failed tests, TypeScript green. | Resume Phase 4 sequential widget repair; push fixes; rerun dashboard/full replica; merge tracks only after gate evidence |
| 3 | Shared-pattern consolidation (whole codebase) | not started | — | `docs/shared-patterns.md` catalog first |
| 4 | Remaining: product items (A) + security re-check (B) | in progress (verify) | branch commits `e0196914cd..f84aad0ce7` cover A1-A7 + security; A8 owner-decision recorded | Audit plan-vs-branch after Part 3; B re-run audits |
| 5 | CI green on PR #202 | not started | PR green at takeover (199 pass / 1 skipping) | Loop `gh pr checks --watch` after each push |
| 6 | Tailwind v3 -> v4 (`chore/tailwind-v4`, separate PR) | not started | 4 local commits, unpushed (pre-existing) | Only after Part 5 green |

## Part 1 steps (playbook items 1-8 + tests)

| Step | Status | Last commit | Next step / note |
|---|---|---|---|
| TZ-1 core resolver + range helper + unit tests | done | `cf1d4d79c7` | — |
| TZ-2 zone suffix / duplicate ISO removal (~36 sites + batch) | done | `cf1d4d79c7` | duplicates logged in `docs/followups-plan.md` |
| TZ-3a prose/duplicate migration + en.json sync + push | done | `0d90f894fc`, `9c3586d103` | — |
| TZ-3b direct-formatter migration (shared layer) | done | `d4653c5517` src + `86bb6e735d` tests + `330fb6052d` i18n | Full suite 2724/57248 green |
| Calendar values unshifted (LA + Kiritimati tests) | done | `d4653c5517` + `86bb6e735d` | `formatMonthYear` day-rollover validation; `dateFormat.test.ts` 82 green |
| `useConversionTimezone` + `resolveRawTimezone` (conversion boundaries) | done | `d4653c5517` + `86bb6e735d` | RateForm + JourneyAssurancePage converted; `timezone.test.ts` extended |
| TZ-4 API `timezone` sends + backend zone params + Go tests | done | `284851a318..147f180cf3` (7, pushed) | Vitest 2727/57276 + tsc + Go green at push; PR202 run in progress |
| TZ-5 guard (lint/audit) + ALL-routes (277) sweep | in progress | `e24583d253` timeline fix + Codex calibration 2026-10-22 | Guard done (R1-R5, 3725 green); sweep spec + 12-route calibration done; timeline zoned bucketing done; waitoracle panel calibration 2/2 pass (/charging + /tesla-charging-sessions @1280, tzIso/zones/dupes 0). Full 277-route sweep pending (timeboxed; run at TZ-7 gate or via CI smoke). |
| TZ-5c marker-free migration (user update) | done | `2fbe414e..edf280bfeb` (4 + docs + Analytics pin) | `tz-computation` 72->0 verified 0 in web/src, all other `tz-*` 0 (1 absence test kept); playbook no-suppression rule present |
| WaitOracle backend zone param + useCharging + panel (wip handoff fix) | done | `66eda8c6d5` wip + `a09dc6ec15` fix | Backend `?timezone=` (400/UTC default), store AT TIME ZONE $3, Predict(loc); hook sends effective tz; panel best_hour + no UTC; Go + 43 panel + 43 trips + tsc + split + trio + audit green |
| TZ-6 e2e spec (UTC browser, LA then Tokyo) | done | TZ-6 spec (this change) | `web/e2e/timezone-display.smoke.spec.ts` 4/4 green (chromium-smoke, mock build reuse); TZ=UTC browser, `tz_display_default=user` + `timezone_user` LA/Tokyo; drive times + Quick-view drawer, timeline daily bucket (Mar 8 LA / Mar 9 Tokyo) + Review-details range drawer (end-inclusive, no Mar 10) + Inspect drawer; no raw ISO / zone names; tsc + split-check green; audit unaffected (specs excluded by design); no markers added. |
| Freshness-header CORRECTION (owner override: `f6d6be4106` KEPT) | done | `b7c55d6ab2` revert-of-revert + `b3f0ba6272` docs + `658e6563fc` verify | `f6d6be4106` (one shared FreshnessDot per widget, top-right corner, header icons directly left) restored; only `c8aad38605` + `dc22ed9bfb` stay reverted. Header guard (`dashboard-widget-headers` + overflow + unit ownership) STAYS PASSING — never SKIPPED/DROPPED. i18n pins regen via sanctioned `--typed --checkpoint-catalog`; FreshnessDot back, 14 calls, shell/edit-chrome shas + dashboardTokens entry restored; combined 68/68. Vitest dash scope + tsc + split-check green; TZ-6 e2e 4/4. Followups-plan SKIPPED-task wording corrected this change. |
| TZ-7 i18n regen, full local replica, commit, push, PR green | not started | — | Section 3 replica, then push once |

## Part 2 summary mirror (updated after every task once started)

Phase 0 gate PASS. Phase 1 Gate 1 PASS (see below). Phase 2 pilots 9/9 done and GATE 2 PASS (pushed 462bde401e): wave1 288598cf28 climate, cde879bcbf onboarding, 357162dda0 recent-drives, ef09f6e589 battery-gauge, ac254eaf53 vehicle-hero; wave2 df582bf4b4 charge-status, 928a3ed11f security-status, e65b7f3136 quick-nav, 11d794a694 fleet-posture. After captures 18 PNGs (light+dark) in docs/widget-redesign/after/ (untracked), self-reviewed: exactly one FreshnessDot top-right per widget, no Live/2m-ago. Gate fixes: 012af5e74b typography tokens (audit 0), aab39c80be i18n keys (checklist.progressDone, widget.batteryGauge.*, widget.verifiedFields, dashboard.fleetPosture.*) + sanctioned re-pins (QuickNav/RecentDrives checkpointed), 7762911dcc hero footer + catalog fallbacks, 462bde401e preservation tests updated to After whole-percent precision. Gate checks: dashboard scope 222 files/4654 green, tsc 0, TZ audit 3726/0, typography 0, i18n 8110/8110, split OK. Deviations/data gaps logged in state.md + data-gaps.md (charge-status charger-type/added-kWh omitted, never fabricated). Phase 1 detail:
workflow; commits 7d81146653..7f68554fce + gap 1b9f1e9470 on
`feat/widget-redesign`). Review fixes: 8bc591fbec (status-grid `relative`
hook; RouteEfficiency bar test → After spec), 900d526fe5 (GMT-offset caption
removed from WidgetChartSummary; guard R6 restricts offset helpers to .ts
tick/timeline helpers; 2 new guard tests), dbf279d573 (i18n regen via
sanctioned generators incl. new key widget.comparison.previousLabel).
Review follow-up: rank numerals restored in `WidgetRankedList` after the
first full suite found 1 failure in `shared-library-completion` (caller-ranked
identity; route-efficiency After preview confirms numerals). Branch pushed,
tracking `origin/feat/widget-redesign` (never pull/push
`fix/post-merge-followups` from the worktree). Gate 1 checks: tsc 0, eslint 0,
TZ audit 0 (3726 files), guard tests 18/18, i18n 8110/8110, split-check OK,
dashboard scope 222 files green, first full suite 57382/57387 (1 ranked
failure, now fixed); final full-suite re-run pending. Carry-overs recorded in
state.md (TimelineItem density, FlowArrow.label adoption, dead barColor
props). Every Phase 2 pilot task row in state.md is annotated with the TZ
rule line; the same line goes into every worker prompt. Next: Phase 2 pilots
(9) via rolling workflow.

## Part 3 counts (once started)

Catalog: not started. Coverage: 0%. Found / replaced / new-shared /
exceptions / bugs-fixed: —.

## Decisions log

- Startup-budget fix (Lighthouse red: startup 401.6KB > 400KB; main 398.6KB):
  TZ-3b..TZ-5c date-layer growth (+636 lines in `dateFormat.ts`, +88 in
  `timezone.ts`) landed in the shell's startup closure. Fix by moving
  route-only code out of the entry (real bytes, no suppression, no behavior
  change): new `web/src/lib/dateConvert.ts` (zone/wall conversions, ISO/GMT
  helpers, durations, chart labels, conversion-zone hook) + new
  `web/src/hooks/useDateLabels.ts` (month/weekday/relative-day labels bound
  to settings) split off `useDateFormat`; `timezone.ts` keeps display
  resolution only. Updated the TZ guard (`SHARED_DATE_MODULES`,
  `KNOWN_FORMATTERS`, exempt files, fix hints) and its 16 tests. Moved lib
  tests keep asserting identical behavior from the new paths; one widget
  test gained a parallel `useDateLabels` mock (same convention). Result:
  399.6KB, `perf:check` strict green. NO API CONTRACT change (internal SPA
  modules only); DATA STORAGE untouched. Duplication note: `dateConvert`
  carries local `browserTimezone`/`isTzMode` copies (5-line probe + predicate)
  to stay free of value imports from the widely-mocked `@/lib/timezone`,
  same documented pattern as the existing `dateFormat.browserTimeZone` copy.
- Display uses sanitized `resolveTimezone` (invalid -> browser -> UTC,

- Display uses sanitized `resolveTimezone` (invalid -> browser -> UTC,
  never throws); business-instant conversion uses new unsanitized
  `resolveRawTimezone` so invalid saved zones throw -> form validation
  error instead of silently converting in a guessed zone (RateForm;
  same class audit ongoing for journey/schedule forms).
- `formatDateRange`: half-open `[start, endExclusive)` minus 1ms via
  `formatRange`; non-midnight exclusive ends show the civil day of the
  last included instant (pinned by ThermalPanels fr-FR/Tokyo test).
- `useDateFormat().tz` is the single resolved display value (settings
  `tz_display_default` + override + vehicle, browser fallback).
- Freshness (CORRECTED 2026-10-22, owner override): `f6d6be4106` (one shared
  dot per widget, top-right corner, header icons directly left) is KEPT and
  the header guard stays passing — the 2026-10-21 "SKIPPED/frozen, revert
  everything" directive is void; only `c8aad38605` + `dc22ed9bfb` stay
  reverted. Uncommitted tree verified (2026-10-21) to contain zero
  freshness-dot diffs.
- 2026-10-21 docs-only push (playbook + this file) without the section-3
  replica: two markdown files cannot affect code checks; full replica
  runs at the Part 1 gate (TZ-7) as scheduled.
- TopParkingLocations zone-label assertion was stale (fails on HEAD
  too) and contradicts spec section 3: flipped to assert absence; the
  no-shift assertions (the test's actual subject) pass unchanged.
- Intermediate pushes (TZ-3b batch) go without the section-3 replica:
  full Vitest + tsc gate them, CI gives the early e2e/visual signal,
  and the full local replica runs once at the TZ-7 Part 1 gate.
- TZ-4: backend `?timezone=` validates IANA (400) and defaults UTC;
  omitted hook zones resolve to `useDateFormat().tz` (Auckland
  fail-before/pass-after tests). Rolling stats, caller-less legacy
  getters, the AI cost port (UTC), journey drive-vehicle frame, and
  automation schedule zones intentionally unchanged (see plan file).
- TZ-5 resume: pre-compaction triage dump was partly stale
  (MobileChartTooltip, ErrorBoundary, utils/date.ts don't exist in this
  tree; counts verified fresh: 83 Intl + 27 toLocale + 5 timeZoneName
  in non-test source). Trust files over handoff notes.
- Dev server `npm run dev -- --host` (PIDs 69812/45664, started 10/21
  12:55 PM, owner unclear) left running; revisit at the TZ-7 replica.
  Codex runtime node processes are the user's tooling, untouched.
- TZ-5 guard: `{/* */}` markers for JSX-children positions, `//` for JS
  and JSX-attribute positions (TS accepts `//` between attributes);
  attribute-position ISO hoisted to marked consts in 3 files.
- TZ-5 finding -> Part 3: `formatDateTime(period.start)` shifts date-only
  boundaries by zone (mileage label fixed via `formatDayKey`; generic
  StatPeriod renderer + producers need a shared boundary helper).
- TimestampTool keeps raw ISO rows (`tz-tool-subject`: the converter's
  subject is the format itself); daylog keeps GMT offsets
  (`tz-dst-offset`: fall-back disambiguation, same class as
  `formatChartInstant`); quiet-hours per-window zones stay
  (`tz-schedule-data`, same class as automation schedules).
  SUPERSEDED by TZ-5c: all `tz-*` markers removed via shared API
  (toIsoString/formatGmtOffset/supportedTimeZones); same behaviors kept.
- TZ-5c shared API: `browserTimeZone()` added to `dateFormat.ts`
  (mock-safe leaf; `timezone.ts` keeps its own for hook-adjacent code
  because 40+ tests mock that module); validity results cached in
  `safeTimeZone` (bucketing calls it per row); `zonedDateParts`
  normalizes h23 midnight 24->0 for all callers.
- TZ-5c parity calls: seasonal/hvac canonical-case readback dropped
  (unpinned; real inputs are canonical IANA ids); midnight hour-24
  rows now bucket at hour 0 instead of 24/null/crash (chargeAdvisor,
  drivingRhythm, hvacCycling latent crash, EnergyPage evening-bucket,
  QuietHoursSummary leg); invalid zone/NaN paths still throw RangeError
  where the old Intl code threw (daylog keeps its RangeError->ISO catch
  for bad locales too, pinned by test).
- TZ-5c guard: R2 stays syntactic (flags ALL toLocale*, dates and
  numbers) instead of a typechecker program — a full TS program in lint
  would cost minutes per run, and the shared number layer
  (@/lib/numberFormat) exists precisely so numbers never format
  directly either. R4 narrowed: skips `<time dateTime>`, TimeStamp/
  DateTime props, ISO nested in shared-formatter calls
  (import-aware + known names); still flags direct, chained
  (`.slice`), and non-shared (`String(...)`) ISO in JSX.
- TZ-5c certificate bug: `tz-number-format` markers sat INSIDE the
  print-document template string and leaked into certificates; removed
  with the fmtInt migration + regression test.
- Other markers verdict (user review): `relative-time:` (17),
  `flow-cta:` (10), `not-destructive` (4) belong to the FROZEN
  freshness audit — cannot touch (playbook global). `no-action:`
  (754) belongs to audit-empty-state-cta — each documents a product
  decision (no meaningful recovery action); removal needs 754 product
  re-reviews or deleting a workflow gate. All kept; both audits green.
- i18n: trio regen covers 7 touched producers + pre-existing stale
  SecretRotationOperationalBrief (stale since `eccca4cdc1`, fixed via
  the sanctioned generator, translations verified clean).
- Wip handoff fix (Codex 2026-10-22): `66eda8c6d5` added waitoracle `?timezone=` (400/UTC default), store AT TIME ZONE $3, Predict(loc), journey plumbing (UTC-preserving per TZ-4 intentionally-unchanged), useCharging effective-tz send; but renamed backend JSON `best_hour_utc`->`best_hour` without updating panel/test/en.json, breaking tsc + Lighthouse. Fixed by `a09dc6ec15`: panel/test use `best_hour`, dropped all UTC suffixes per Part 1 rule 3 (subtitle/bestHour/chart title/col), title fallback aligned to catalog sentence case, i18n via sanctioned generators (split + trio producer/combined + catalog pins).
- API CONTRACT `best_hour_utc`->`best_hour` (waitoracle forecast): all in-repo dependents fixed in same change (hook type, panel, panel test, en.json + split/trio/pins, Go forecast + handler + tests). Repo-wide grep: old name remains only in handler absence-assertion (contract test, intentional) + queue/progress history notes. No OpenAPI (`docs/public/openapi.yaml` has no waitoracle), no `docs/api-reference.md` entry, no generated clients, no e2e/mock harness refs, no scripts, ar/he have no `wait_oracle` keys. External readers: undocumented internal SPA API (only reader is `useCharging` in this repo); old UTC-suffixed name was factually wrong (hours are zone-framed) and violates Part 1 rule 5, so old field NOT kept (intentional breaking rename, pinned by absence test). DATA STORAGE: store uses `AT TIME ZONE $3` query-time only, no migration, stored values unchanged. NO SUPPRESSION: no new exception/marker/allowlist added.
- Pending user update verified done: `tz-computation` 0 in `web/src` (grep 0), all other `tz-*` 0 in src (1 absence-assertion test kept); playbook global no-suppression rule present (`docs/agent-playbook.md:126`).
- Queue reconciled 2026-10-22: TZ-5c commits `2fbe414e..edf280bfeb` done/pushed; `docs/widget-redesign/state.md` correctly absent (Part 2 not started; dir holds only inputs).
- AnalyticsPage `re-scopes and re-fetches` failure was PRE-EXISTING
  (reproduced on pristine base worktree `4fd5b3bd1c`) and zone-fragile:
  the test resolved `7d` in the local zone while the page re-resolves
  the scope preset in the UTC display zone, disagreeing by a day
  whenever local and UTC dates differ (red in PDT evenings, green in
  CI/UTC). Fixed by pinning both resolutions to UTC; 20/20 green in
  PDT, UTC, and Pacific/Kiritimati.

## Blockers

- PR202: run 39699895510 (TZ-4 push) responsive-14/-29/-34 + visual (1/64) red — triage at TZ-7 (likely intended display changes). Latest run 39715700018: only Lighthouse CI red, caused by wip `best_hour_utc` break (tsc); fixed by `a09dc6ec15`, pushing to verify. Visual/e2e diffs regen at TZ-7 after all display work. Not blocking TZ-5/6.
- :8080 serves the TeslaSync SPA (user's server via Docker; left running).
  Mock-preview proxy escapes would fail loudly (HTML vs JSON), not via
  ECONNREFUSED. Caveat recorded for the TZ-7 replica; revisit if escape
  anomalies appear.

## Exact next step

Startup-budget fix + i18n re-pin pushed (`94b2f4a62a`); Lighthouse green path
verified (startup 399.6KB). Track B Gate 1 corrections fixed. Next: (1)
confirm re-run of both full unit suites is green, (2) commit/push any
remaining review fixes, (3) dispatch Phase 2 pilots in rolling waves of 5
(every task carries the TZ rule line), (4) TZ-5 full 277-route sweep,
(5) TZ-6 e2e re-run, (6) TZ-7 full local replica + push + PR green.
