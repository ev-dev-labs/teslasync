# Work queue — branch `fix/post-merge-followups` (PR #202, draft)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`. Freshness rule and
kept twins (`vehicle-twin`, `digital-twin-mini`) apply to every part.

Last updated: 2026-10-22 by Muse (TZ-5c marker-free migration).
Branch HEAD: `4fd5b3bd1c` + uncommitted TZ-5c (shared API, 40-site migration, guard rewrite, i18n regen — committing + pushing next).

## Parts overview

| Part | Name | Status | Last commit / note | Next step |
|---|---|---|---|---|
| 1 | Time zone: follow setting everywhere, remove duplicates | in progress | `147f180cf3` TZ-4 pushed (7 commits); TZ-5 inventory done | TZ-5 migration batches + guard, TZ-6 e2e, freshness revert, TZ-7 replica + push |
| 2 | Dashboard widget redesign (119 widgets) | not started | inputs present (`README.md`, `widgets-compare.html`, `widgets.json`) | Phase 0 only after Part 1 clean + pushed; Phase 1 header task SKIPPED (freshness frozen) |
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
| TZ-5 guard (lint/audit) + ALL-routes (277) sweep | in progress | `e24583d253` timeline fix | Guard done (R1-R5, registry+wired, 3725 green); sweep spec + 12-route calibration done; timeline zoned bucketing done. 277-route full sweep not yet run. |
| TZ-5c marker-free migration (user update) | in progress | this push | `tz-computation` 72->0, all other `tz-*` kinds 0 in src (1 absence-assertion test kept); shared API +3 helpers; guard rewritten marker-free (16 tests); R2 stays syntactic (see decisions). Next: commit + push, then sweep findings + TZ-6 |
| TZ-6 e2e spec (UTC browser, LA then Tokyo) | not started | — | Drive times, drawers, ranges, midnight day assignment |
| Freshness-header revert (`c8aad38605`, `dc22ed9bfb`, `f6d6be4106`) | not started | revert set identified | `git revert` (no resets) after Part 1 code done; `cad1237f5f` only if shell-preservation fails; i18n conflicts via generators |
| TZ-7 i18n regen, full local replica, commit, push, PR green | not started | — | Section 3 replica, then push once |

## Part 2 summary mirror (updated after every task once started)

Not started. No `state.md` yet.

## Part 3 counts (once started)

Catalog: not started. Coverage: 0%. Found / replaced / new-shared /
exceptions / bugs-fixed: —.

## Decisions log

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
- Freshness: frozen per playbook global rules; committed header work
  (`f6d6be4106` + 2 follow-ups) will be reverted; uncommitted tree
  verified to contain zero freshness-dot changes.
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
- AnalyticsPage `re-scopes and re-fetches` failure is PRE-EXISTING
  (reproduced on pristine base worktree `4fd5b3bd1c`); must still be
  fixed for the TZ-7 green gate. Queued after the TZ-5c push.

## Blockers

- PR202 run 39699895510 (TZ-4 push): responsive-14/-29/-34, Lighthouse
  CI, Windows visual (1/64) red; job logs unavailable until the run
  completes. Triage then; visual/e2e diffs likely intended TZ-4 display
  changes, regen at TZ-7 after all display work. Not blocking TZ-5/6.
- :8080 serves the TeslaSync SPA (user's server via Docker; left running).
  Mock-preview proxy escapes would fail loudly (HTML vs JSON), not via
  ECONNREFUSED. Caveat recorded for the TZ-7 replica; revisit if escape
  anomalies appear.

## Exact next step

Commit TZ-5c in logical groups + push, watch PR202 checks. Then:
AnalyticsPage pre-existing failure probe (needed for green), 277-route
full sweep + wait-oracle backend zone param, TZ-6 e2e, freshness
revert, TZ-7 full replica + green.
