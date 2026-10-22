# Work queue — branch `fix/post-merge-followups` (PR #202, draft)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`. Freshness rule and
kept twins (`vehicle-twin`, `digital-twin-mini`) apply to every part.

Last updated: 2026-10-22 by Muse (post-compaction resume).
Branch HEAD: `147f180cf3` (7 TZ-4 commits pushed; PR202 run in progress, 5 jobs red so far).

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
| TZ-5 guard (lint/audit) + ALL-routes (277) sweep | in progress | `e2c6972b61` batch 3 | Batch 3 done (12 labels.ts sites -> shared + `showMinutes`; driving 209/3359 green, tsc clean). Next: driving/battery/analytics lib Intl sites, guard + sweep |
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

## Blockers

- PR202 run 39699895510 (TZ-4 push): responsive-14/-29/-34, Lighthouse
  CI, Windows visual (1/64) red; job logs unavailable until the run
  completes. Triage then; visual/e2e diffs likely intended TZ-4 display
  changes, regen at TZ-7 after all display work. Not blocking TZ-5/6.

## Exact next step

TZ-5: migrate remaining direct date formatters to the shared layer in
batches (Vitest + tsc per batch), then write the guard audit + tests,
then the 277-route sweep. Then TZ-6 e2e, freshness revert, TZ-7.
