# Work queue — branch `fix/post-merge-followups` (PR #202, draft)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`. Freshness rule and
kept twins (`vehicle-twin`, `digital-twin-mini`) apply to every part.

Last updated: 2026-10-21 ~20:40 UTC by Muse (continuing after Codex).
Branch HEAD: `9c3586d103` (+ uncommitted Part 1 work, see below).

## Parts overview

| Part | Name | Status | Last commit / note | Next step |
|---|---|---|---|---|
| 1 | Time zone: follow setting everywhere, remove duplicates | in progress | `9c3586d103` docs (pushed); TZ-3b batch uncommitted, 19/32 suite failures fixed | Fix remaining 13 failures (AdvancedIntelligence 3 next), then calendar-value tests, TZ-4 backend, TZ-5 guard + 277-route sweep, TZ-6 e2e, freshness revert, TZ-7 replica + push |
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
| TZ-3b direct-formatter migration (shared layer) | in progress | uncommitted (~100 files) | 13 failures left: AdvancedIntelligence 3, ChargeDeparture 3, Carbon 1, ShareCard 1, LiveBattery 1, LiveMotor 1, DrivingDynamics 1, WeeklyPunchcard 1, ApiLogsPage 1 |
| Calendar values unshifted (LA + Kiritimati tests) | not started | — | `"2026-03"` -> Mar 2026, `"2026-03-01"` -> Mar 1 2026; midnight-UTC instant converts |
| TZ-4 API `timezone` sends + backend zone params + Go tests | not started | triaged | `useRangeState` fallback + `useWeeklyDigest` to effective zone; carbon `EXTRACT(HOUR)` zone param; survey other day-bucket endpoints |
| TZ-5 guard (lint/audit) + ALL-routes (277) sweep | not started | — | Fail on direct date formatting, raw ISO, zone names, extra pickers; record per-route results |
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

## Blockers

None. (The 13 remaining Part 1 test failures are in-progress work,
actively being fixed, not blockers.)

## Exact next step

In `web/`: fix `AdvancedIntelligenceClosure/Pages`,
`JourneyAssurancePage` failures (check `zonedWallTimeToUtc` /
`toZonedDatetimeStr` / `safeTimeZone` batch-1 semantics vs pinned
conversion/seeding behavior), then the remaining 10, then full suite.
