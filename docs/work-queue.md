# Work queue — branch `fix/post-merge-followups` (PR #202, draft)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`. Freshness rule and
kept twins (`vehicle-twin`, `digital-twin-mini`) apply to every part.

## CI-driven continuation (2026-10-25, after `ec53fca3b5`)

- User strategy override is now reflected in playbook section 3: local
  TypeScript/lint and related unit/E2E specs ONLY; CI owns full validation.
  No full local quality suite or replica. Timeouts require inspection and
  smaller runs, not another identical run or an early stop.
- Section 0: expected branch fetched/pulled; clean at `ec53fca3b5`.
  Removed an empty stale `.git/index.lock` only after confirming no git
  process owned it. Existing CLI is this session's parent; IDE-owned
  headless Copilot and Playwright test-server remain user tooling.
- Round 0: **42 failing / 158 passing / 3 skipped** checks at `ec53fca3b5`.
  CI run `40198967208`: one stale statistics source assertion causes unit
  shard 1/8, coverage and aggregate failures. CodeQL reports two test-only
  incomplete-escaping/sanitization patterns. Quality run `40198967056`:
  dashboard acceptance/design mismatches, real cost-chart clipping,
  timezone violations on 23 routes, and six failing Windows visual shards
  (1,5,10,14,39,56 out of 64). No baseline update has run.
- Evidence:
  `/home/atul/.copilot/session-state/d279d214-3d92-4a65-b124-08c71e983561/files/ci-rounds-20261025/`.
  `round-0-checks.json`, `ci-failed.log`, `quality-failed.log`,
  `quality-failure-summary.json`, `codeql-check.json`,
  `codeql-annotations.json`. Read bounded summaries, not entire logs.
- Fixes 1-3 verified: cost breakdown's full-height headline no longer takes
  the chart's allocated height (wrapped in a content-sized, non-shrinking
  flex item); added containment regression. All eight signed/eight-decimal
  axis geometry scenarios pass unchanged, wrapper proxy escapes=0.
  Updated the statistics source contract to require the canonical shared
  efficiency conversion already used by production, not inline legacy
  multiplication. Removed CodeQL-triggering incomplete regex escaping in
  the pair-table test using exact accessible names, and strengthened the
  watch privacy assertion with case-insensitive matching and no script DOM.
  Five targeted suites: 121/121 tests. Actual seven-category production
  audit: six counts 0, TypeScript passes; complete lint chain exits 0.
  Evidence: `fix-1-3-unit.log`, `fix-1-axis-browser.log`,
  `fix-1-audit.log`, `fix-1-3-lint.log`.
- Fixes 4-5 verified: departure forecast now consumes the shared selected
  display zone rather than forcing vehicle mode; user/fixed/vehicle
  provenance stays truthful and model weekday/evidence agree in conflicting
  Tokyo/Los Angeles cases. Charge-departure source history bounds/counts
  move into the existing Review details drawer; identical bounds render
  once, and retained-source recovery links remain usable there.
  Departure/model tests pass 61/61. Related/frozen run initially passed
  8,001 tests with one stale card-face assertion failing; the corrected
  drawer/recovery suite then passed 9/9. All frozen catalog suites passed.
  Actual TypeScript and affected ESLint exit 0. Both unchanged 1280px route
  guard cases pass, tzIso/tzZones/tzDupes=0, wrapper proxy escapes=0.
  Mock build initially failed its catalog check while generators were
  updating inputs; serial catalog check and rebuild both exit 0 afterward.
  Source line counts 190->198, 303->308, 126->126, 119->119, 78->83;
  panel/chart reference counts unchanged (0/3/0/3/0). Driving and charging
  hook paths all match router registrations. Sanctioned generators also
  refresh the CostBreakdown producer receipt missed in the first commit.
  Evidence: `fix-4-departure-unit.log`, `fix-4-5-targeted-unit.log`,
  `fix-5-alignment-final.log`, `fix-4-5-mock-final.log`,
  `fix-4-5-tsc.log`, `fix-4-5-eslint.log`, `fix-4-5-browser.log`.
  All five actual seven-category production audits report six counts 0
  and TypeScript pass; full existing lint/audit chain exits 0
  (`fix-4-5-audits.log`, `fix-4-5-full-lint.log`).
- Round 1 at `2f6aba7b3d` is IN FLIGHT: 1 fail / 43 pass / 146 pending /
  3 skipped, not a final reduction from round 0. First observed failure:
  Windows visual shard 1/64; no snapshots changed yet.
- Windows mirror again confirmed clean; downloaded ONLY failing visual
  artifacts (1,5,10,14,39,56/64). All six old/new pairs reviewed: dashboard
  shards 1/5/10/14/56 differ only in the intended compact quick-navigation
  tiles (including forced colors); shard 39 differs only in semantic
  battery-bar palette. Approved for one-time targeted regeneration.
- Current next step: push fixes 4-5, then repair the largest remaining
  dashboard acceptance group and semantic timezone roots; inspect current
  CI failure logs as jobs finish. Completed fixes this session: 5.

## Resume verification (2026-10-25, after `354deb1c1f`)

- Section 0: fetched/pulled the expected branch; working tree clean. Stopped
  the idle CLI from the clean prior handoff; the IDE-owned Playwright test
  server is user tooling and was not stopped. Windows mirror confirmation:
  `git.exe -C D:/repos/teslasync status --short` returned no output.
- Completed result 1: removed redundant zone-name captions from both
  ClimateControlPage charts and vehicle-detail RecentDrivesSection. Actual
  dates still use the selected zone through the existing shared formatter;
  no hooks, API contracts, storage, sections, or calculations changed.
  Regression tests failed before (2 failures/100 tests), then passed
  (100/100). TypeScript, focused ESLint and both seven-category audits pass
  (six violation counts each: 0). Source lines 1602 -> 1600 and 131 -> 130;
  panel/chart counts unchanged at 14 and 1. Mock build rebuilt; actual
  `/climate`, `/climate-control`, `/vehicles/7` guard runs at 1280px pass
  3/3, each with tzIso/tzZones/tzDupes=0; wrapper proxy escapes=0.
- Evidence for this resume:
  `/home/atul/.copilot/session-state/d279d214-3d92-4a65-b124-08c71e983561/files/`.
  Caption regression/build/audit/browser logs use `timezone-*` and
  `e2e-build-caption.log`.
- Completed result 2: startup closure reduced from 413,843 to 409,084 gzip
  bytes (404.1 -> 399.5 KB; unchanged 400 KB budget). Extracted the unchanged
  repair-scoped query, fleet-setup keys and signal-kind normalizer into
  synchronous leaf modules; shell consumers no longer pull route-only
  useDataRepair/useFleetSetup/useSignals implementations. Re-exported
  existing public names; no request/response contract or timing changed.
  Private-map production build and the ENTIRE strict `npm run perf:check`
  exit 0; source maps confirm the three domain hooks leave startup.
  Five existing focused suites pass 204/204. Changed request-bearing hooks
  match registered routes (21/2/5/19/5 patterns; extracted helper: zero).
  Regenerated split catalogs with the sanctioned generator: dataRepair now
  lives only in the lazy system bundle, not shell plus a duplicate fallback.
  Catalog-locality suite passes 132/132, including the new exact locality
  regression. Full lint/audit chain and TypeScript exit 0. Evidence:
  `startup-final-*`, `startup-hooks-contract.log`, `catalog-locality-final.log`.
- Completed result 3: reconciled hero E2E against the already committed
  compact redesign (one meaningful battery meter, textual range/temperature
  chips, Details navigation). No production readings/actions were removed.
  Added named accessible groups and explicit Unknown descriptions for
  missing/non-finite range/temperature readings in BOTH hero surfaces, and
  a real 44px hit target for the widget Details link. Added six fail-before/
  pass-after unit regressions; complete hero suites pass 53/53.
  E2E retains every unknown/zero/regen case, theme and viewport; validates
  actual SI-derived numbers and signed power on the shared card (compact
  dashboard intentionally has no power chip), rejects invented meters/
  obsolete quick actions, and now activates Details by keyboard and checks
  the rendered destination. Complete matrix passes 34/34, proxy escapes=0.
  Explicit null/empty detail-endpoint fixtures preserve strict API matching
  during the newly tested navigation; no matcher was loosened.
  TypeScript, focused ESLint, both seven-category audits and full lint pass.
  Source lines 417 -> 430 and 310 -> 314; shell/panel counts unchanged.
  Reviewed both surfaces' 320px dark and 1440px light screenshots. Windows
  baselines remain untouched. Evidence: `hero-*` logs and browser screenshots
  in `web/test-results/` (not committed; later runs may replace them).
- Completed results 4-8 (section 3 checks):
  route registry/template freshness, route/scenario contracts and discovery
  exit 0 (harness 24/24; discovery 2,094 tests in 89 files);
  Go build and complete `go test -race ./...` exit 0;
  accessibility 13/13 and Firefox/WebKit 6/6 pass;
  browser performance exits 0 with 7 passed and 2 flaky (drives/FSD passed
  on retry). Successful browser wrappers each report zero proxy escapes.
  TypeScript and split-catalog check also exit 0. Logs:
  `replica-contracts.log`, `go-build.log`, `go-test-race.log`,
  `replica-a11y.log`, `replica-performance.log`, `replica-cross-browser.log`.
- Completed result 9 (INCOMPLETE validation, not a suite pass): bounded
  full Vitest attempt with four workers was stopped for handoff after
  approximately 13 minutes. Its last captured completion markers cover
  423 files / 21,508 tests with no completed-file failure markers; there
  is NO final full-suite summary. See `full-vitest.log` and
  `replica-partial-summary.json`. Do not treat this as full coverage.
- Completed result 10 (INCOMPLETE validation, not a quality gate pass):
  parallel local quality replica attempts hit repeated 240s operational
  timeboxes. Shards 1,2,5,6,9,10,13,14 timed out (124); shards 3,7,11,15
  were safely stopped; 4,8,12,16 never started. No shard completed its
  wrapper proxy check; NONE is counted passing. All partial logs and
  isolated artifacts are `quality-N.log` / `quality-N-results/` in the
  evidence directory.
- **Section 0b handoff at the requested ten-result boundary and repeated
  replica-timeout stop condition.** Three verified source repair commits
  are persisted. No worktrees were created. All session-owned Vitest/
  Playwright/preview processes were stopped and checked absent; the
  IDE-owned Playwright test-server remains user tooling. No Windows
  baselines were regenerated. Full replica remains incomplete, so this
  handoff push is NOT a successful part/phase gate.
- Last observed checks before this handoff push (old `354deb1c1f` HEAD):
  155 pass / 45 fail / 3 skipped. PR #202 is NOT green. After pulling this
  handoff, inspect checks for the pushed repair HEAD rather than those
  historical checks.
- Exact resume: first collect fresh PR failures; then repair the semantic
  timezone roots listed in "Exact next step" below and any genuine
  remaining unit/browser roots. Finish the full unit run and all 16
  quality shards with adequate bounded per-shard time (the 240s attempt
  here was insufficient; do not change test timeouts/guards). Reuse
  verified ancillary results only if no intervening changes affect them.
  Run the section 3 gate, push, then use the CLEAN Windows mirror under
  section 4 for reviewed old/new comparisons and ONE intended baseline
  update. Continue until PR #202 green or the next required handoff.
- Next: repair sleep/departure/energy-orchestrator timezone semantics and
  charge-departure duplicate timestamps. Full replica remains incomplete;
  the once-only reviewed Windows baseline update has NOT run.

## Merge-then-fix execution (2026-10-25)

- Prep: recovered the existing Zod 4.6.7 manifest/lockfile upgrade for the
  Security Scan finding (Zod 3.25.76; fixed version reported as 4.6.6).
  Adapted geofence lazy localized validation to Zod 4 error callbacks and
  preserved the alert place-ID validation message. TypeScript, focused
  schemas (82/82), ESLint, and split-catalog check pass. Full replica is
  deferred to the combined validation phase requested for this operation.
- Shared merge: `origin/feat/shared-patterns` at `c2d4ae5cb2` merged without
  conflicts. Combined/catalog checkpoint and split generators ran against
  the merged LF sources; all seven frozen suites pass (7,728/7,728).
  `npx tsc --noEmit` exits 0. Shared modules are retained.
- Shared merge committed and pushed as `b235484463`.
- Palette merge: `origin/feat/chart-palette` at `96ad7e99d1` integrated
  after shared patterns. One DriveStatCards conflict resolved with the
  shared energy conversion AND new `COLOR.GOOD` token. Preserved both
  branches' behavior. Aligned 12 case-only fallback discrepancies to the
  catalog; verified and regenerated 13 producer checkpoints, combined and
  catalog fingerprints. Extended the catalog generator to verify and
  regenerate the canonical fixture digest when approved copy changes;
  updated the neon-help copy fixture to the intended palette wording.
  No hash was hand-edited. TypeScript exits 0; eight palette/frozen suites
  pass (7,782/7,782).
- Palette merge committed and pushed as `11d3fd570c`.
- Cleanup done: GitHub automatically marked #205 MERGED into this branch
  after pushing its merge commit (therefore `gh pr close 205` refused);
  #204 was already CLOSED. Posted the requested exact comment to both.
  Both shared/colors worktrees had empty porcelain status and zero commits
  ahead of their origin branches; verified both branches ancestor-merged,
  then removed both worktrees without force. The pre-existing detached
  `/tmp/teslasync-palette-base` worktree was not created here and is retained.
- Combined validation so far: full frontend lint/audit chain exits 0;
  actual seven-category violations audit reports all six pattern counts 0
  and TypeScript passes; backend `go build ./...` and `go test -race ./...`
  exit 0. Route registry/template checks pass for 266 actual routes;
  E2E route/scenario contracts pass, harness contracts 24/24 pass,
  discovery lists 2,087 tests in 88 files before the new scanner contracts.
  Full Vitest was interrupted at the command time limit (exit 130); it
  did not produce a passing full-suite result.
- Windows baseline update BLOCKED: mirror status is
  `?? docs/widget-redesign/`. Section 4 forbids syncing a dirty mirror;
  no files there were modified and no baselines regenerated. Use Windows
  CI artifacts until the mirror is clean.
- New confirmed failure group: Lighthouse startup closure is 404.1 KB,
  above the unchanged 400 KB budget. Reproduced on merged production build;
  public AND private-map production builds exit 0; strict private-map
  performance check fails only that budget (273/432 startup icons; 13
  feature modules). No budget or threshold changed.
- Unit conversion worker replaced 17 guarded factors plus one elevation
  conversion across 16 source files; 78 focused tests passed, including
  17 new regressions. Five coupled stale palette assertions fixed to
  explicit shared tokens; affected suites 26/26 pass. Parent verification
  and generator-only fingerprint regeneration complete; committed as
  `0f45d02e08`.
- Complete CI unit failure inventory collected from all eight shards:
  69 files / 145 failing assertions, grouped into intended palette
  expectation changes, deleted production contracts, and shared-format
  expectations. Full raw logs and file/assertion inventory are in the
  session evidence directory below; all three disjoint test workers have
  finished and released their files.
- Production palette regression fixes: restore InsightsEngine up/down
  trend glyph records using canonical GOOD/BAD colors (previously only
  neutral remained, causing runtime crashes); restore TimeMarker's public
  canonical severityTokens re-export; replace duplicate blue signal-series
  colors with six distinct canonical teal/violet/amber/green/blue/rose
  tokens. Original behavioral assertions retained.
- E2E attribution used a real pre-merge build at `a2308886c3`, not
  unchanged-source inference. All six representative hero/route cases
  fail there too; this does NOT establish attribution for every case.
  Fixed competing dashboard init-script seeding, unknown battery meter
  semantics, and a timezone scanner visibility bug: descendants of a
  clipped accessible chart table were falsely treated as visible.
  New scanner checks real ancestor clipping, including forced-colors
  overrides; no class allowlist, skip, or tolerance changes. Focused
  browser proof 12/12, hero unit tests 40/40; parent timezone switch and
  scanner contracts 9/9, preview proxy escapes 0.
- Remaining E2E roots (not declared fixed): compact/full hero contracts
  disagree with old four-gauge/three-action E2E expectations; real visible
  UTC captions remain on climate, vehicle recent drives, sleep efficiency,
  departure forecast and energy-orchestrator; charge-departure-alignment
  repeats two visible friendly timestamps. Full 266-route TZ-5 sweep and
  16 quality shards still required after repairing these causes.
- Security Scan on merged PR run now SUCCESS (observed, not assumed).
- Evidence directory:
  `/home/atul/.copilot/session-state/da9135b7-c9ba-4ad9-a198-fd85558513da/files/`.
  Start with `combined-unit-failures.json`, `e2e-root-cause/report.json`,
  `merged-private-perf.log`, and the final handoff entry below.
- Verified repair commits: `0f45d02e08` canonical conversion adoption,
  `725355f7f6` visibility-aware timezone scanning/dashboard seeding/battery
  semantics, and `54a115d1f0` production palette contracts plus exact
  intended palette/copy expectations. No Windows baselines changed.
- Parent combined verification: 81/81 test files and 9,210/9,210 tests
  pass, covering every collected CI unit failure, changed regression
  tests and seven frozen i18n suites. Existing changed test/spec assertion
  calls increased from 4,894 to 4,915; no per-file assertion reductions or
  new skips. These are targeted results, NOT a passing full Vitest suite.
  Final actual audit reports six pattern counts of zero and TypeScript
  passing; full `npm run lint` including all registered audits exits 0.
  Evidence: `batch-all-affected.log`, `batch-final-audit.log`,
  `batch-final-lint.log`.
- Handoff at the requested completed-result/context boundary: repair
  commits are persisted serially; push this batch and resume in a fresh
  session. Last observed checks on pre-repair `11d3fd570c`: 124 success,
  31 failure, 20 in progress, 24 queued, 3 skipped. PR #202 is NOT green.
- Exact next steps: inspect checks on the new pushed HEAD; rebuild
  `E2E_MOCKS=1 npm run e2e:build` after the final palette source fix, then
  fix the unresolved hero behavior/contract mismatch without removing
  coverage. Repair visible timezone/duplicate-time roots listed above
  (exact file evidence in `e2e-root-cause/report.json`), then run the full
  TZ-5 route sweep and TZ-6/7 plus section 3 local replica. Reduce the
  actual 404.1 KB startup closure below the unchanged 400 KB budget.
  Full Vitest still required; use a bounded runner and preserve partial
  output if its command reaches the playbook limit. For visual work,
  recheck the dirty Windows mirror without changing its unrelated files;
  use CI artifacts if it remains unavailable. Review old/new visuals and
  update Windows baselines ONCE only after causes and intended changes
  have been reconciled; then loop PR checks until green.
- Combined failure groups to investigate after merging: branch-only
  vehicle-hero-readings/route-layout regressions (~53 reported; attribution
  must be re-established rather than trusting the branch handoff), remaining
  inline feature conversions (18 reported), existing responsive/timezone
  failures, Security Scan, Windows visual diffs, and any new merge failures.
- Shared-pattern call sites marked `pending` in
  `docs/shared-patterns-state.md` remain a separate later adoption task.
- No Windows baselines have been regenerated in this session.

Last updated: 2026-10-25 by Copilot merge-then-fix session.
Latest repair commit: `54a115d1f0` (followed by this handoff documentation).
Both requested branches are merged in order. The removed shared/colors
worktrees are absent. The pre-existing detached
`/tmp/teslasync-palette-base` remains untouched. All five batch workers
are idle/released; no batch-owned preview/test process remains.

## Parts overview

| Part | Name | Status | Last commit / note | Next step |
|---|---|---|---|---|
| 1 | Time zone: follow setting everywhere, remove duplicates — TRACK A (`fix/post-merge-followups`) | in progress | `e71d532ee7` removes climate/vehicle captions; `54ade03061` restores startup to 399.5 KB; other semantic roots remain | Sleep/departure/orchestrator semantic repairs, duplicate instants, full 266-route TZ-5 sweep |
| 2 | Dashboard widget redesign (119 widgets) — one active branch | done | Widget redesign merged at `248c9d13d5`; Track B worktree removed; Phase 4 dashboard scope repaired and verified. Recovery commits `823c8802c8`, `16bf49ebd1`, and `7b3fabbe7a` pushed. | Dashboard suite green; collect remaining PR/TZ failures and continue the one-track fix list |
| 3 | Shared-pattern consolidation (whole codebase) | in progress | Shared modules merged via `b235484463`; remaining feature conversions adopted via `0f45d02e08` | Call sites marked `pending` in `docs/shared-patterns-state.md` remain a separate later task |
| 4 | Remaining: product items (A) + security re-check (B) | in progress (verify) | branch commits `e0196914cd..f84aad0ce7` cover A1-A7 + security; A8 owner-decision recorded | Audit plan-vs-branch after Part 3; B re-run audits |
| 5 | CI green on PR #202 | in progress | Not green; hero matrix 34/34 and strict startup perf pass after current repairs; full replica in progress | Finish bounded replica inventory, preserve repairs, then remaining timezone roots and once-only reviewed Windows baselines |
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

Shared modules and branch state were merged in `b235484463`. Remaining
call-site adoption is tracked in `docs/shared-patterns-state.md`; rows
marked `pending` are explicitly deferred to a separate task. No aggregate
adoption percentage is claimed.

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

Use the newest resume/handoff section at the top, not the historical recovery
entries below. Current repairs: `e71d532ee7` (caption regressions),
`54ade03061` (startup 399.5 KB), `9c6fbb98ec` (hero unknown/zero/readings and
Details keyboard navigation, 34/34 E2E cases).

Remaining semantic timezone roots must NOT be fixed by hiding or simply
relabeling the UTC disclosures:
- `useEnergy.ts:useSleepEfficiency` currently sends date-only start/end
  without a timezone; SleepEfficiencyPage and its analysis clamp against
  inclusive UTC days. Reconcile request/query boundaries with the shared
  selected zone first, then fix RangeSourceCoverage/SleepMethodologyPanel
  copy and format calendar dates with the shared calendar formatter.
- `DepartureForecastPage` explicitly calls `useDateFormat('vehicle')`,
  overriding the user's selected display mode, and provenance prose still
  names UTC fallbacks. Model and display must share the selected effective
  zone; preserve truthful fallback provenance without raw zone labels.
- `home-energy/components/ScenarioControls.tsx` exposes peak hours as UTC.
  Reconcile actual tariff/simulation hour semantics before changing labels.
- `ChargeDepartureAlignmentPage` renders both source bounds (including
  identical first/last instants) and AlignmentPairs timestamps; inspect the
  guard's exact duplicate records. Keep evidence accessible once, through
  the existing details surface, rather than dropping accounting information.

Then rebuild mocks, finish TZ-5/6/7 and the full section 3 replica. Mirror was
confirmed clean but has NOT been synced or used; after pushing, compare
old/new Windows images and regenerate intended redesign/palette snapshots
ONCE per section 4. Do not regenerate in Linux. Continue PR #202 checks;
Parts 3-6 later adoption/migration work stays deferred as previously recorded.

## Recovery handoff (2026-10-23)

- Dashboard lint/typography/freshness repair commits: `47cec22796`,
  `d31e666484`, and `ab52bd2631` pushed. Worktree clean.
- Verified locally: dashboard 174 files / 3079 tests, focused chart tests
  111/111, freshness 71/71, TypeScript, chart-frame, chart-safety,
  chart-legend, typography, freshness, SI FE gate, and split i18n check.
- Production build passes with startup JS 399.6 KB.
- PR #202 fresh run `40060471218` failed first at generated split-i18n
  artifacts, then at dashboard source modernization tests and aggregates.
- The sanctioned split generator is now clean locally. Its two generated
  removals of obsolete Just-now keys remain to commit.
- Remaining blocker: 31 frozen i18n producer/checkpoint expectations now
  mismatch intentional source removals and shared absolute-time formatting.
  Re-pinned only through the repository trio generators/checkpoints; do not
  hand-edit hashes or catalog fingerprint counts.

- 2026-10-24 recovery: refreshed the 31 producer/checkpoint group through
  the sanctioned trio generators (no hash hand edits). Verified combined
  producers 96; known catalog calls 41,867; 29 source producer checkpoints
  refreshed; 7 frozen i18n suites pass 7,728/7,728; TypeScript and split
  catalog checks pass; dashboard code-guardian audit reports 200 files/0
  violations. Next: commit/push this batch, then collect and fix PR #202
  remaining failures by root cause.
  First PR unit batch: stale widget copy assertions and canonical
  RecentActivity duration fixtures updated; 125/125 focused tests pass.
