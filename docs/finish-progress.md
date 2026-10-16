# Frontend finish progress (Phase 6 → Phase 7)

Resume file for whoever continues this work. Updated and pushed after every group.

## Current priority order (2026-10-16 test triage)

1. Rerun the full Vitest suite with `--maxWorkers=4`, retaining a structured report and comparing its numbers with the previous 3,826 failures before changing code.
2. Classify the remaining failures by cause and compare with the pre-redesign baseline; record counts and uncertainty here.
3. Repair the largest groups first: migrate outdated UI assertions while preserving their intent, fix confirmed behavior bugs, and stabilize reproduced flakes. Commit and push each group to `ui/simplification`.
4. Separately categorize the 295 failed Phase 6 items by their latest recorded reason. Update this file and `.runner/state.json` as each repair group changes its verification evidence.

The web gates are build, `npx tsc --noEmit`, lint, and `node scripts/split-i18n-catalog.mjs --check`. Every new user-facing string must use `t()` and a complete-sentence `en.json` key; plurals use i18next `count`.

## Test failure triage (2026-10-16, before repairs)

The limited run used `npx vitest run --maxWorkers=4 --reporter=json --outputFile=../.runner/gates/vitest-triage-max4.json` on unchanged test/production code. The retained JSON, stderr log and classified assertion index are under `.runner/gates/` locally; these diagnostic artifacts are deliberately not committed.

| Run | Passed tests | Failed tests | Skipped | Files | Failed files | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Previous default-worker run | 53,079 | 3,826 | 4 | 2,705 | 588 | 570.97 s |
| Four-worker rerun | 53,079 | 3,826 | 4 | 2,705 | 587 | 1,619.8 s |
| Documented pre-redesign gate (`fc1f2c5d3f`) | 55,308 | 1,536 | 4 | 2,702 | Not retained | Not retained |
| Older archived pre-redesign log | 48,686 | 850 | 0 | 2,582 | 175 | 548.82 s |

Limiting concurrency produced **no net reduction** in failed assertions. The all-pages nested-surface contract passed in the limited run, following its timeout/failure during the previous busy run; this identifies a resource-sensitive check, not an explanation for thousands of failures. The exact previous 3,826-case JSON was not retained, so aggregate equality does not prove identical failed test identities. An earlier structured report with 3,847 failures was recovered separately and is retained locally as `vitest-prior-structured.json`.

Compared with the documented 1,536-failure baseline, the current total is **2,290 higher**, with 61 additional tests and three additional files. A per-category comparison to that exact baseline cannot be reconstructed from its aggregate receipt. The older 850-failure log retains 849 distinct failure identities: **629** also fail now and **220** are no longer failing or no longer present under the same name. Unmatched current identities must not automatically be called redesign regressions because the test sets and source revisions differ.

The following is an exhaustive primary-diagnostic classification of the **3,826** failures. The assertion source and representative rendered output were inspected for each family. These are repair queues: remaining UI/state and value/API assertions still require focused diagnosis before deciding whether the test or production behavior is wrong.

| Failure family | Current failures | Same identity in older archive | Evidence / repair approach |
| --- | ---: | ---: | --- |
| Evidence disclosure and card-face expectations | 930 | 28 | Status, bounds, source context and methodology queried before opening Review details; preserve those assertions in the relevant drawer and retain card-face value checks. |
| Removed metric wrappers or unavailable-value tiles | 904 | 32 | Old nested label selectors, tile-count and placeholder assertions; migrate populated labels/values to the flat structure and check unavailable-state explanations without inventing measurements. Loading cases need separate behavior checks. |
| Other UI copy, structure or state assertions | 673 | 99 | Missing labels, headings, narrative or state text whose cause is not established by the error alone; inspect the intended flow before editing. |
| Value, API, formatting or behavior assertions | 543 | 94 | Incorrect expected arrays/values, query lifecycle, request shape or locale assumptions; reproduce and check the source contract. This count is not a count of confirmed product bugs. |
| Catalog and source snapshot contracts | 452 | 271 | Physical-leaf hashes/counts and source-call fixtures lag changed source/catalogs. There are 154 distinct failing names, inflated to 452 executions by imports between test files. Preserve unique regression intent when separating fixture data. |
| Action accessible-name or interaction queries | 128 | 54 | Button/link queries fail after action/header changes or before reaching the required flow; inspect accessible names and exercise the original action. |
| Ambiguous text or role queries | 101 | 27 | Responsive copies, tooltip text or repeated regions match global queries; scope assertions to the intended surface and verify actual duplicate UI separately. |
| Runtime errors and incomplete fixtures | 95 | 24 | Missing mocked exports/functions, undefined response fields and missing Recharts context; repair the fixture only after confirming the runtime contract. |
| Explicit timeout failures | 0 | 0 | No timeout is the primary diagnostic in the limited run. Retained-refresh race candidates still need focused repeats. |
| **Total** | **3,826** | **629** | |

The largest established repair family combines evidence disclosure, flat metric structure and action queries (**1,962 failures**). Start with the nine vehicle-systems test files containing the obsolete `[data-operational-metric] > div:first-child` label selector: the limited baseline is **196 passed / 124 failed** across **320 tests**. Keep the same labels, values, unit conversions, query assertions and populated cases. Then work through drawer migrations, independent loading/missing-value behavior and the remaining families in descending size.

Three assertions fail in the limited run but were absent from the earlier 3,847-failure report: JourneyAssurance departure-zone preference rerender, Fleet API retained rejected-refresh text, and GDPR manifest retained-refresh recovery. Source revisions differ, so these are timing/state candidates rather than confirmed new flakes. The governance cache test also fails before its cache assertions: it expects a rejected response containing `Plan recording failed` but receives an undefined-property error. Its existing item note therefore does not establish an invalidation bug.

The separate **295-item Phase 6 reason breakdown** and every item ID are grouped in the appendix below. No status was changed during triage.

### Repair group 1: flat metric label selectors (2026-10-16)

Updated the nine vehicle-systems test files listed by the obsolete-selector grep to find the existing metric label directly inside its flat tile. All original labels, values, raw-unit expectations, interactions and assertions remain. The same 320 tests improved from **196 passed / 124 failed** to **233 passed / 87 failed**: **37 resolved, zero new failures, no skipped or removed tests**. The remaining 87 failures are retained for the next disclosure/unavailable-value/loading migrations; this is a scoped result, not a fresh full-suite result. Details are in local `.runner/gates/metric-selector-repair.json`.

Typecheck, production build and full lint/audit chain pass. No catalog keys or production code changed. Appended the per-file results to 38 matching Phase 6 records without changing their acceptance status; no currently failed Phase 6 record belongs to these nine assigned test files. State totals remain **981 done / 295 failed / 0 pending**.

### Repair group 2: shared brief visibility and accessible details (2026-10-16)

Confirmed a production visibility bug with new regressions before fixing it: a pending source without a measurement disappeared, an explicitly resolved missing source exposed a placeholder while another source loaded, and a group mixing missing/invalid readings had no explanation. Three regression cases failed and one control passed before the change. Metric visibility now honors each source's loading override; a group with no visible values gets the existing explanatory state. Raw values, calculations, queries and translations are unchanged.

Migrated the shared accessibility suite to check status, scope, full source context and methodology in the drawer while retaining card value links, full translated accessible names/tooltips, source navigation, focus trapping, focus restoration and Escape behavior. Missing/invalid classifications remain explicitly checked and unavailable fields are checked as omitted with a counted explanation; measured zero remains actionable. The two shared suites pass **38/38**, including four added cases. The broader shared/hook/nine-page run is **273 passed / 87 failed across 360 tests**, with **zero newly failing identities** against the controlled baseline. Six existing accessibility failures are resolved; the 87 vehicle-systems failures from group 1 remain. Local report: `.runner/gates/shared-brief-repair.json`.

Typecheck, production build and the full lint/audit chain pass. Matching Phase 6 records retain their status and receive the refreshed scoped verification receipt. Next: the pressure summary's existing per-source loading booleans currently reach only captions; verify forwarding them to metric loading and migrate its unavailable-value assertions.

## Current UI simplification checkpoint

Working on `ui/simplification`. Rows 0-4 are complete and pushed; row 5 (charging) is in progress; row 6 (remaining features) is in progress. Shared dashboard headers cluster controls at the right, the freshness dot is the per-widget refresh action, hover-only expand controls sit to its left without reserving header width, and widget content avoids nested summary scroll areas. Climate no longer repeats an inner title; title-equal metric captions are hidden. Both StatStrip and OperationalBrief distribute metric rows evenly with `maxPerRow`. Captured Edge screenshots at 375px, 768px, and 1440px are committed under `docs/ui-simplification/`; the Battery widget freshness control measures the same 16px inset as its title at all three sizes. Focused shared/dashboard suites pass 111/111; focused vehicle suites pass 239/239 across seven files. Split catalog check, full lint, typecheck, and build pass on the last shared checkpoint (CSS parser and startup bundle warnings remain). Rows 5-7 and the full Vitest suite remain outstanding.

Nested-surface follow-up: `FleetSectionBrief` and `FleetOverviewBrief` render embedded because their analytics summaries sit inside the analytics `Section`, and some are also inside `AnalyticsPanel`. The AnalyticsPage regression confirms the overview brief uses an embedded surface and no standalone one (1 focused test passed). The exit check now greps direct briefs, composed feature wrappers, surface components, and metric-bank attributes; trace each match through parent components. Shared `StatStrip` defaults to 3 and its six-item test verifies 3 + 3. Existing Edge captures for Analytics/Driving at 375px, 768px, and 1440px were visually checked: KPI metrics are unboxed and responsive; the 375px layout stacks without clipping. Wider AnalyticsPage + StatStrip execution exposed six copy/state/date failures in AnalyticsPage that are unrelated to these surface and row-layout changes; leave them for the scheduled full-suite repair.

The expanded parent trace found two more actual nested briefs: `StatisticsBatteryBrief` inside its `LayoutCard`, and `FsdOperationalPanel` inside its `LayoutCard`. Both now pass `variant="embedded"`; regressions assert the embedded surface and absence of a standalone surface. Weekly Digest suite passes; the focused StatisticsPage calendar-month tests pass 4/4. The full StatisticsPage + WeeklyDigestPage run reports 48 failures / 95 passes, all failures in StatisticsPage assertions that predate this surface change (the new embedded assertions pass); keep those queued for full-suite repair. Touched-file ESLint passes.

The same expanded trace corrected eight additional definite nested briefs in Benchmark cards, Next Charge, Automation Activity, Command Center, Service Intelligence, and Quiet Hours. Split-i18n check, `tsc --noEmit`, full lint/audits, and production build pass; build retains the CSS parser and 404.8 KB startup bundle warnings. The broad focused batch (8 suites) reports 62 failed / 78 passed because existing assertions still expect pre-drawer missing-value and metadata behavior; record and repair those in the scheduled test pass. These changes add no user-facing copy or catalog keys.
## Where things are

- Active branch: `ui/simplification`, based on `fix/dashboard-followups`.
- Current UI checkpoint: rows 0-4 complete; row 5 charging in progress; rows 6-7 remain.
- Phase 6 is deliberately paused until the UI task and full Vitest repair finish. The latest requested inventory was 312 pending and 114 failed; reconcile with `.runner/state.json` when Phase 6 resumes. No Phase 6 items have been updated in this continuation.
- Preserve the uncommitted Analytics hook edits and the untracked `docs/ui-simplification-task.md`; they predate or belong to the user's workspace context. Do not stage them as part of UI vehicle commits.
## How each group is done

1. List the open items for one page/component cluster (items sharing a primary
   file), read the page once.
2. Run that area's tests. Most failures are **test drift**, not product bugs (see
   patterns below). Most items were already implemented by earlier attempts that
   could not be verified because Vitest appeared to hang (see Step 0).
3. Implement what is genuinely missing, add a focused regression, re-run tests,
   `node scripts/split-i18n-catalog.mjs` then `--check` when en.json changed,
   eslint the touched files.
4. Commit with item ids in the message, push both branches, mark items done.

### Recurring drift patterns (check these first)

- Saved display precision: shared formatters print at user precision
  (`0.00°C`, `28.50 kWh`, `-4.50 kW`), not compact literals.
- Shared StaleRefreshWarning button is **Refresh**, not Retry. Page headers also
  expose a "Refresh data · …" control — match exact names (`/^(Retry|Refresh)$/`).
- Driving briefs use the canonical **Retained source** label (`driving.brief.retained`).
- Help tooltips also have `role="tooltip"`; scope chart-tooltip queries.
- ChartCard renders a visible title and an sr-only chart title; match
  `[data-card-title]` or use the heading role.
- Chart doubles that replace the container need inert cartesian children:
  spread `(await import('@/test/chartTestDoubles')).inertCartesianParts`.
- Real `XAxis`/labels: font attrs are on `<text>`, the match is the `<tspan>`.
- Recharts 3 legend icon is the `path.recharts-legend-icon` itself.
- `QueryError` needs a Router (`{ wrapper: MemoryRouter }`).
- `FadeIn` starts at opacity 0 — mock it as passthrough for `toBeVisible`.
- TanStack v5 never settles successfully with `undefined` data; use `null` for
  authoritative empty, and give query doubles `isSuccess` when they must be settled.
- Telemetry/drive `power` is **watts** (backend computes voltage × current).
- Temperature prefs are `'°C'`/`'°F'`, not `'C'`/`'F'`.
- i18next reserved `count` must be numeric (plurals); pass formatted strings
  as `{{value}}` (several remaining TS errors are this pattern).
- Out-of-range readings in shared bars/gauges render as a labeled `group`,
  not `progressbar`/`meter`.

## Step 0 — cleanup (done)

- `git reset` in the main checkout; deleted unreferenced one-off configs/scripts
  in `web/` (`*-verification.config.*`, `*.vitest.config.mts`, `*-check.mjs`, …).
- **Vitest "hang" root cause**: `split-i18n-catalog --check` re-ran every bundle
  check once per namespace (~2m15s) and ran as a Vite `buildStart` plugin on
  every Vitest start. Fixed: check ~12s, skipped under Vitest; Vitest starts in ~2s.
- Committed the verified carried-over worker groups (charging f09, home-energy
  f11, explore f01, firmware-canary fc03, drive-score ds14, fsdinsights f09,
  drive-detail f04, speed-sweet-spot f02, destination-transitions f09).
- RemainingUsefulLife test edits tested behaviour the page never got; parked
  (not committed) — redo them with the diagnostics RUL items (rul-03/04/05).
- The Gradle wrapper bump and `tools/claude.ps1` / `tools/run-workers.ps1` were
  later committed upstream on `fix/dashboard-followups` and merged in (`bd0f2dc53f`).
- Shared harness repair (`c3b4e9b301`): annotation hook mocks
  (`useChartAnnotations`), theme/settings fallbacks for `useChartPalette` in
  `test-setup.ts`, partial `useDateFormat` mocks spread the real hook; later the
  global `useTimezone` stub honours a saved user timezone (UTC default).
- Remote `fix/dashboard-followups` had independently committed the same worker
  changes; merged into the finish branch (`aa951a0fea`) keeping verified versions.

## Step 1 — Phase 6 items

Order: feature by feature, by primary-file cluster.

### Groups done (driving)

| Cluster | Items | Commit (subject) |
| --- | --- | --- |
| Speed profile | sp01–03, sp05–09 | four efficiency bands legend |
| Segments | seg-qa-02/04/06/07/08/10/11 | native toggle buttons |
| Trip planner / copilot / address | tp01/02/04–09/11/16 | copilot precision tests |
| Drivetrain health | f01/02/04/05/06/09 | health labels, motor states, thermal bands |
| Drive detail / compare | f01/02/07/11/14/15/17, compare f06 | watts energy fix, (0,0) GPS placeholder |
| Cold start | f02/03/07/10 | fixture temperature prefs |
| Destination transitions | f01/07/08/10 | CSV scope, matrix labels, canonical title |
| Arrival reliability | arr-003–006 | canonical labels, settled motion |
| Departure forecast | df02/05/06/08 | refresh fixture |
| Drive DNA | dna002/004/005/010 | plural emissions, truthful watts copy |
| Drive score | ds05/06/07/10/11/12/13 | singular exclusion notice, truthful insights |
| FSD insights | f01/02/04/05/08/10/13 | icon selector test fix only |
| Efficiency / target | f003/f008, target f03/f04/f06 | five distinct bands, scorecard export key, boundary labels |
| Explorer | exp05/exp09 (exp03 left failed) | filter grouping test |
| Regen efficiency | 04/05/07/08 | harness fixes only |
| Speed sweet spot | f03/f04/f05 | exportable coerced to boolean |
| Driving rhythm / dynamics | rhythm f01/f03/f04, dynamics f03/04/05/07 | exact-instant window, truthful time-semantics copy |
| Drive compare | f01/f05/f07 | neutral paused state instead of endless loading |
| What-if / share / journey / replay markers | wi-003/006/007, drive-detail f03, jf-02, trips f10 | pure marker model + localized plural labels |

Real product bugs fixed along the way: drive-detail energy/regen estimate was
1000× too large; (0,0) GPS placeholder stretched routes; TorqueHistory ticks
lost scalable typography; thermal bands conveyed only by colour; missing CSV
export on origin concentration; stale "kW ×1000" methodology copy; efficiency
scorecard JSON/CSV dropped the target gap; inline ErrorBoundary rendered blank
labels without i18n init and was not announced (now role=alert).

### Groups done (trips)

| Cluster | Items | Notes |
| --- | --- | --- |
| Trip replay / journey / stops | replay f01/02/03/08/11/13/14/15/16/18/19, journey 01–04, departure 06 | inline journey-create failure alert; settings/timezone unmocked where the cache is seeded |

### Next up

Driving and trips are complete (except explorer exp03). Next: vehicles (62), vehicle-systems (45), charging (48), system (47),
notifications, settings, battery, and the rest.

## Known open issues (left failed in state.json)

- explorer exp03: DestinationDirectory mobile details open with all fields, but
  focus does not return to the row trigger after Escape
  (`DestinationDirectory.test.tsx:216`); the shared MobileDataTableAdapter
  restore tests pass, so it is specific to this composition.

## Step 2 — Phase 7 gates

Not started. TypeScript baseline: 41 errors at HEAD, 38 now (none added).

## Step 3 — close out

Not started.

## Handoff verification (2026-10-15)

- Verified the unfinished `PhysicsLedgerPage.test.tsx` and
  `VehicleListPage.test.tsx` changes. Corrected the timezone regression to use
  the saved vehicle/user timezone behavior and restored an explicit numeric
  string measurement case; both page suites pass (**118 tests**).
- Verified the committed `useDialogFocus.ts` visibility change with both hook
  suites (**36 tests**). No further hook change was needed.
- The linked vehicle work items remain pending for their broader implementation
  audits; test success alone does not close those items. Next, continue with the
  remaining vehicle clusters, then vehicle-systems, charging, system,
  notifications, settings, battery, and the rest.

## Vehicles verification (2026-10-15)

- Ran the full vehicle frontend test area after repairing stale expectations and
  selectors: `npx vitest run src/features/vehicles src/components/vehicles src/lib/vehicleState.test.ts`.
- Result: **84 test files passed, 1,716 tests passed, 4 skipped**. Repairs aligned
  timezone fixtures with saved display settings, retained numeric-string evidence,
  used current semantic lamp tokens, fixed locale-aware count assertions, and
  scoped accessible icon/status queries to their owning cards.
- The 100 vehicle work items remain pending for item-by-item acceptance (one
  includes backend day-log coverage); these test results are recorded in runner
  notes and do not close unrelated requirements. Continue with vehicle-systems.

## Vehicle-systems: climate and HVAC clusters (2026-10-15)

- Focused suites passed: `ClimateControlPage.test.tsx` and
  `HvacCyclingPage.test.tsx` (**106 tests**).
- Fixed unresolved HVAC run-directory counts: null counts previously flowed
  through `fmtInt` as zero. They now display localized “Unknown” while retaining
  the configured 50-run cap. Corrected current icon name, scope, precision, and
  timezone expectations in the related tests.
- Vehicle-systems remains in progress; its broader sweep still has failures in
  maintenance, media, preconditioning, tire pressure, safety, climate summaries,
  software updates, and related presenters. Continue with those clusters.

## Vehicle-systems verification (2026-10-15)

- The full vehicle-systems area is green: `npx vitest run src/features/vehicle-systems` passed **55 test files, 939 tests**.
- Corrected stale expectations for the current UI contracts, fixed several cases where formatted interpolation counts used the reserved i18next `count` key, and ensured unknown/invalid preconditioning reuse and source coverage remain unknown. Also corrected query identity, date, and DataTable fixture assertions.
- The 47 linked vehicle-systems work items remain open for item-by-item acceptance; this broad suite is a verified checkpoint, not a blanket closure. Continue with charging.

### Charging checkpoint: cost-analysis view-model contracts (2026-10-15)

- `npx vitest run src/features/charging/components/cost-analysis/types.test.ts` passes (**13 tests**).
- Updated stale shape assertions for the richer coverage/disclosure result, pinned accounting to UTC fixtures, and retained unknown actual-cost savings and unverified distance as unavailable.
- The broader charging area is still in progress; its initial sweep had **143 failing tests** across 37 files. Continue cluster by cluster.

### Charging checkpoint: Powershare enum and runtime panels (2026-10-15)

- Focused helpers, signal constants, runtime, and stop-reason suites pass (**85 tests**).
- `humanizeEnum` now falls back to its verified English label when the translator has no initialized result. Test fixtures now use the actual generated proto enum identities (`PowershareStateEnabled`, `PowershareStopReasonStatus*`).
- A separate `TrendCard.test.tsx` timestamp-export case remains failing and is not included in this checkpoint.

### Charging checkpoint: cost-analysis area (2026-10-15)

- The full cost-analysis component area passes: **17 test files, 280 tests**.
- Updated the remaining stale end-to-end expectation to keep distance-based gasoline comparisons unavailable without verified driven-distance evidence. Core aggregates, calculator, table and chart suites all pass.

### Charging checkpoint: charger resilience (2026-10-15)

- Verified the full requested focused suites: `chargerResilience.test.ts` and `ChargerResiliencePage.test.tsx` passed (**51 tests**).
- Closed the four charger-resilience runner items after confirming the implementation covers unavailable energy denominators and session fallback, preserves unknown identities, supplies contextual accessible labels, and uses numeric table column kinds. The implementation is in `5fed1ace2f`.

### Charging checkpoint: thermal-tax page and components (2026-10-15)

- `ChargingThermalTaxPage.test.tsx` plus the full `charging-thermal-tax-modernization` component area pass: **5 files, 42 tests**.
- Aligned tests with localized number grouping, current observed-window empty-state copy, the raw timestamp included in chart rows, and the shared export menu's supported options. Unknown heater readings remain represented as unavailable and the shell/provenance tests pass.


### Charging checkpoint: curve helpers and page selector (2026-10-15)

- `charging-curve/helpers.test.ts` and `ChargingCurvePage.test.tsx` pass (**2 files, 91 tests**).
- The default charger-category label helper now supplies a safe English fallback when the global translator is uninitialized; the selected-session fixture renders the verified Supercharger category label again. The broader curve/modernization cluster still has open failures.
### Charging checkpoint: charging-list search and pagination (2026-10-15)

- Updated the bare `free` search token to use the existing recorded-zero-cost filter, and scoped responsive pagination assertions to the loaded session total. The focused page suite improved from 13 failures to 5 failures (**88 passed, 5 failed of 93**).
- The remaining failures are prior-period copy, filtered empty-state rendering, and loading skeleton counts. Keep the charging-list group open and resolve these before treating charging as complete.

## Phase 7 gate follow-up: actionable empty states (2026-10-15)

The original empty-state audit reported 47 findings after removing the generic
`no-action:` comments from the handoff fix. The lint rule now accepts the shared
`EmptyState` `variant="informational"` only for self-populating or healthy
informational panels; the existing project-specific no-action escape hatch is
preserved for prior cases, and no new no-action comments were added here.

- **35 actionable findings:** Retry for recoverable source states, clear search
  or date filters for filtered results, vehicle/setup navigation where a
  prerequisite is missing, and source refresh/all-time/all-vehicle actions for
  charging history. The three charging history EmptyStates choose between a
  concrete scope action and an informational explanation according to state.
- **12 informational findings:** panels that populate from later telemetry or
  supported source data, plus the healthy “no attention items” state. Each now
  explains what event, input, or source response will make content appear.
- Added a focused `EmptyState` test for the informational variant. Full gates and
  affected-area regressions are still in progress; do not treat these counts as
  a completed Phase 7 gate result.

## Phase 7 gate check update (2026-10-15)

- `node scripts/split-i18n-catalog.mjs --check` passed after running the normal
  generator to refresh five English bundles/manifests. No package files changed.
- `npx tsc --noEmit` passed after the actionable empty-state changes.
- `npm run lint` passed ESLint and audits through `audit:chart-a11y`, then found
  five raw `ResponsiveContainer` charts rejected by `audit:chart-frame`:
  departure forecast, destination transition profile, origin concentration,
  speed consumption, and drive evidence. Those chart-frame repairs are next.
- Focused tests for 29 affected files: **925 passed, 77 failed**. Failures were
  spread across existing assertions in 19 files; detailed follow-up is needed
  before declaring the full suite result. The standalone `ChartContainer.test.tsx`
  suite passed **21/21** after clarifying its annotation-only fixture.

## English catalog completion (2026-10-15)

Applied the catalog requirement for the new empty-state copy: 25 complete
English sentences now live under their translated `t()` keys in `web/src/i18n/en.json`.
Regenerated the split bundles and verified `node scripts/split-i18n-catalog.mjs --check` passes.
Changed fallback wording that had reused unrelated keys to dedicated catalog keys.

### Phase 7 gate follow-up: chart-frame audit (2026-10-15)

- Extended the chart-frame audit to verify every production JSX caller of a plot
  component that owns a `ResponsiveContainer`. This covers the five plots whose
  shared frame is supplied by a parent component.
- Added regression coverage for fully framed composition and for rejecting a
  plot with any unframed production caller. The audit test suite passed **12/12**.
- `node scripts/audit-chart-frame.mjs` now reports **364/364 framed**, zero raw.
  The next lint run passed the chart-frame audit and exposed one additional
  chart-legend adoption gap in the arrival reliability profile.
- Added the profile's existing stable parent chart keys to its embedded frame.
  The focused plot suite passed **7/7**, and the legend audit now reports **113
  adopted, 5 waived, 0 candidate warnings**. Full lint was stopped at its first
  failing audit; rerun it to verify the remaining sequence.

### Phase 7 gate follow-up: mutation policy audit (2026-10-15)

- The full lint rerun cleared chart frame and chart legend, then found the live
  mutation policy catalog was out of sync with request-boundary guards already
  in the hooks. Updated the classification to recognize shared guard options,
  classify guarded writes as live-only, and allow the guarded helper functions
  used by mutation hooks. The audit passes with **104 live-only, 145
  mode-independent, and 1 infrastructure mutation hook**.
- Full Vitest completed with **55,308 passed, 1,536 failed, 4 skipped** across
  2,702 files (three unhandled errors). The repository's prior documented
  baseline was about 1,830 failures. The full report includes substantial
  existing i18n snapshot/physical-leaf count failures and stale fixture errors;
  the modified arrival reliability profile suite passed **7/7**.
- `npx tsc --noEmit` passed. `node scripts/split-i18n-catalog.mjs --check`
  passed. Root `go build ./...` and `go test ./...` completed successfully.
- The first full lint rerun after the mutation policy update next failed at
  the virtualization inventory:
  `RecommendationDetails` was missing from the acknowledged set even though
  it fetches fixed 25-record server pages. Added the specific bounded-page
  justification; the standalone virtualization audit now passes with **17/17
  long-list surfaces acknowledged**.

### Phase 7 gate status (2026-10-15, current branch)

- `node scripts/split-i18n-catalog.mjs --check`: pass.
- `npx tsc --noEmit`: pass; the production build's TypeScript and service
  worker typecheck stages also pass.
- `npm run lint`: pass across ESLint and all registered audits.
- `go build ./...` and `go test ./...`: pass.
- Full `npx vitest run`: **55,308 passed, 1,536 failed, 4 skipped**, 3 errors,
  2,702 files. The earlier recorded baseline was about 1,830 failures; the
  focused arrival reliability chart suite passed **7/7**.
- `npm run build` passed on the Phase 7 gate commit `fc1f2c5d3f`, including the
  service worker SHA and source-map postbuild checks. Phase 6 source changes
  followed that gate; rerun final gates after the remaining Phase 6 groups.

### Phase 6 group: vehicles (2026-10-15)

- Reviewed and closed the 68 pending vehicle work records against their focused
  regression coverage. The 34 distinct pending-item test files passed **1,043
  tests, 4 skipped**. The shared-range and legacy-bookmark follow-up passed its
  focused workspace-scope, range-hook, and physics-ledger suites (**67/67**).
- Removed the orphan `/notifications` workspace range registration after its
  scope invariant test exposed that the route is a disabled-prefix root.
- Moved Physics Ledger to the shared header range, retaining route quick ranges
  of 6h and 24h. Legacy `hours/start/end` bookmarks retain their precise bounds,
  including windows longer than the quick presets; requests use the shared
  range's half-open instants.
- Added the catalog sentence `workspace.analysis.presets.6h` and regenerated
  the split catalog. `node scripts/split-i18n-catalog.mjs --check`, focused
  ESLint, and `npx tsc --noEmit` passed. No other new user-facing copy was
  introduced.
- Source commits pushed: `325d08d155`, `dc7f7e054f`, and `c5a755613d`.

### Phase 6 group: vehicle-systems (2026-10-15)

- Reviewed and closed the 49 pending vehicle-systems work records against the
  focused tests named by those items. The 23 resulting test files passed **824
  tests**. Existing records note the broader vehicle-systems suite passed
  **939 tests** earlier on this branch.
- No catalog strings or package files changed in this group. The test output
  included existing jsdom `scrollTo`, chart sizing, and React `act` warnings;
  they did not fail the suite.

### Phase 6 group: charging checkpoint (2026-10-15)

- Fixed and pushed three focused test updates: the chart selector test now checks the accessible fallback label actually rendered by the component; session distance tests preserve finite zero and negative meter deltas; charging-list responsive empty-state tests tolerate duplicated responsive content and account for all four independent insight skeletons. The targeted selector/detail suites passed **91/91**; the charging-list suite passed **91/93**, with two prior-period comparison assertions still failing.
- Powershare fixtures now use the verified `PowershareStateEnabled` enum identity. Preserved unknown enum values rather than guessing labels; helper and page suites passed **72/72**, and the catalog split check passed. Closed `fix-charging-powershare-ps-f03` based on that coverage.
- Charging heatmap grid and page suites passed in prior focused runs. The broader charging-focused batch last reported **958 passed /43 failed** across 27 files; this checkpoint fixed 2 tests in the focused selector/detail suites and a Powershare page regression. Smart Charge still has 7 failing tests; charging list still has 2. The group remains incomplete and the remaining failing files are recorded in the pending charging work items.
- Source/test commits pushed during this group: `a2a1fc3e84`, `089f2ba49b`, `93e30c8c97`, `90bac3bc1f`, `79b480b40b`.
- No new catalog strings were added in this checkpoint.

### UI simplification: charging surface checkpoint (2026-10-15)

- `ChargingSummaryBrief` now forwards an overridable `variant` and defaults
  to `embedded`, which keeps its audited wrapper call sites from adding a
  bordered surface inside their surrounding summary cards, sections, or
  widgets. Its focused regression suite passes **8/8**.
- Grepped every charging `OperationalBrief`/`ChargingSummaryBrief` call.
  The two direct page briefs are page-level sibling sections; the shared
  charging wrapper is embedded by default. No charging `maxPerRow` grids
  need an additional cap; shared StatStrip already defaults to three tiles
  per row and has a six-item 3+3 regression.
- Charging feature suite result: **1,812 passed / 252 failed** across 125
  files. Catalog split check, `npm run lint`, and `npx tsc --noEmit` pass.
  The row remains in progress while the existing charging failures are
  triaged. Browser screenshots remain unavailable in this execution
  environment; Playwright is present in the repository but browser binaries
  are not exposed as a callable browser session.

### UI simplification: vehicle-systems nested brief correction (2026-10-15)

- The vehicle-systems wrapper's existing `embedded` prop only altered its
  title; it did not pass `variant="embedded"` to the underlying
  `OperationalBrief`. The wrapper now forwards the surface mode, and a
  regression proves the embedded marker is present with no standalone
  surface. The new focused regression passes **1/1**. No user-facing copy or
  catalog keys changed.
- The existing complete `VehicleOperationalBrief.test.tsx` file reports nine
  assertions that predate the simplification contract (including expected
  missing-metric placeholders and on-card metadata/status); its other
  assertions include the new regression. Record these for full-suite repair.
- Repository lint and `tsc --noEmit` pass after the change. The full build is
  running before this small UI group is committed.

### Phase 6 group: system checkpoint (2026-10-15)

- Closed the verified command and export follow-ups: CommandsPage passed 15/15, CommandWorkspace passed 10/10, and DataExportPage passed 72/72. The export fallback now localizes its unavailable-vehicle sentence through `t()` and the split catalog check passed after adding the English key.
- ScheduledExportsPanel now passes 38/38 focused tests. Its raw object-error fixture was removed because QueryError intentionally renders its generic network state for non-Error objects; Error details, retry behavior, and async delete flows remain covered.
- The broader system batch is still partial: earlier run was 976 passed / 30 failed in 40 files, with several unresolved chart/jsdom and stale expectation failures. The focused fixes above reduce some of those failures, but the broad batch was not rerun in this checkpoint.
- System commits pushed: `544d90ac6e`, `5e04f8372a`, `4dadc2a932`, `73152fbb48`, `16f3180018`, and `883bf945ec`. ScheduledExportsPanel focused test adjustment is pending commit with this checkpoint.
### Phase 6 group: notifications checkpoint (2026-10-15)

- Fixed filtered flat and grouped inbox empty states so **Clear filters** is visible alongside the primary setup link. The control preserves archived scope and the workspace date range; the focused inbox suite now passes these no-match action cases.
- Corrected AlertDetailDrawer test field-row queries and timeline timestamp expectations. Its suite passes **18/18**; `node scripts/split-i18n-catalog.mjs --check` passes (**57 bundles, 181 fallbacks, 1,264 inlined keys, 0 missing**).
- The initial notifications focused batch reported **1,589 passed / 64 failed** across the notifications and related files. After the inbox action fix, InboxBody is **56/64**; eight remaining failures are in unrelated detail-field/table/mobile expectation cases. ArchivedPage remains **12/14** with two loading/KPI timing or skeleton expectation failures. Continue the remaining notification work items within this group time box.- Additional notification checks: `AlertDetailDrawer.test.tsx` **18/18** and `AlertDetailTimeline.test.tsx` **22/22**. Channel metadata and retained Slack config regression cases passed **2/2**; the wider channel subset remains **106/109** because three create-mode tests still fail while locating the selected webhook fields.- Browser notification hook isolation and the layout ownership assertion are now stable: `useNotificationListener.test.ts` **33/33**, `Layout.test.tsx` **97/97**. The layout test checks installation rather than counting React rerenders.- Audit checkpoint: verified ten already implemented notification follow-ups from their assigned passing tests (AI template revision safety; browser permission/device preference states, policy, sizing and weekday masks; channel numeric semantics and failed-provider responses). These were test-audited without source edits. The area-wide report remains a partial baseline, with unrelated failing notification tests tracked below.- `ChannelsPage.test.tsx` passes **23/23** after aligning the paused-source assertion with repeated responsive content. `ChannelProvidersPanel.test.tsx` still has an unresolved provider-translation assertion and remains open.- Latency cohort copy now uses a counted i18next key with complete singular and plural sentences for usable measurements. Added English `samples_one` / `samples_other` keys, regenerated split catalogs, and verified `node scripts/split-i18n-catalog.mjs --check`. Focused edge and plural cases pass **8/8**; the full panel file currently reports **39 passed / 11 failed** from unrelated rendering, provenance-title, and narrative expectation failures.
- Latency follow-up verification: setting scapeValue: false in the test-only i18next instance fixed four provenance-title assertions. The complete panel file now reports 43 passed / 7 failed; remaining failures are chart-context/error-boundary and stale expectation cases. Split catalog check passed after the existing counted sentence keys. This item remains open.

## Updated execution order (2026-10-15)

1. Pass web build, `tsc --noEmit`, lint, and split-i18n catalog check. Keep the full Vitest suite deferred until after UI simplification.
2. Read `docs/ui-simplification-task.md` and follow it from section 0 on a new `ui/simplification` branch created from `fix/dashboard-followups`.
3. Run the full Vitest suite after simplification and fix failures.
4. Complete every remaining Phase 6 work item: work all pending items area by area and retry every failed item once using its notes. Exclude only when the exact change is replaced by UI simplification, documenting its replacement commit and reason. Leave unresolved retried failures as failed with exact errors. List every excluded and failed item with its reason in this document.

Update `.runner/state.json` and this progress document after each group. This order supersedes previous scheduling notes.

### UI simplification: cross-feature nested evidence surfaces (2026-10-15)

- Completed the call-site sweep for shared evidence wrappers across battery,
  driving, settings, system, trips, vehicle methodology, analytics, charging,
  and dashboard placements. Wrappers that previously created a second
  bordered box now accept/forward `variant="embedded"`; nested callers use
  it explicitly. Vehicle methodology wrappers were already variant-aware.
- Added wrapper regressions proving embedded mode omits the standalone
  surface. Split catalog check, repository lint, `npx tsc --noEmit`, and
  production build pass. The build retains its existing CSS minifier warning
  and 404.8 KB startup bundle warning.
- A repo-wide grep of `OperationalBrief`, `*Brief`, and operational panels
  was paired with parent-surface tracing; nested wrapper matches found in
  this batch are now embedded or have a single outer surface. Shared metric
  banks default to three per row and balance the last rows (six becomes 3+3);
  existing explicit caps and regressions remain in place. The exit checklist
  includes call-site, surface-marker, and max-per-row greps.
- Visual review of Analytics/Driving screenshots at 375px, 768px, and 1440px
  confirmed a single surface per block and balanced six-metric rows. Files:
  `docs/ui-simplification/row6-analytics-driving-after-{375,768,1440}.png`.
- The affected broad area test run remains at 189 failed / 346 passed across
  27 suites; failures are existing evidence-card expectation drift (hidden
  missing metrics and drawer-only metadata), plus unrelated stale caller
  expectations. New embedded-mode assertions pass. Full suite repair remains
  scheduled after simplification.

### UI simplification: repository-wide nested-surface sweep (2026-10-15)

- The AST plan inventory captured 38 standalone brief placements, 26 nested
  bordered surfaces, and four duplicate heading/title pairs. All have been
  fixed: the post-fix audit reports **0 / 0 / 0** unresolved briefs, nested
  surfaces, and repeated titles. Nested `Card` and `GlassPanel` components now
  support `variant="embedded"`, which removes the inner border, background,
  shadow, and print marker. Four Physics Ledger sections retain their outer
  heading and hide the duplicate brief heading.
- Added `audit-nested-surfaces.mjs` and a Vitest contract that scans every
  TSX page. `node scripts/audit-nested-surfaces.mjs` and the Vitest contract
  both pass. The audit is registered in the existing audit registry without
  changing package files.
- Shared component and wrapper regressions pass **75/75**, including embedded
  surface behavior. `tsc --noEmit` and split-i18n check pass. Screenshot
  review at 375px, 768px, and 1440px found a single surface per block and
  balanced metric rows; captures remain in
  `docs/ui-simplification/row6-analytics-driving-after-{375,768,1440}.png`.
- The broader selected area batch reported **426 passed / 95 failed** across
  13 suites. The failures remain existing data-placeholder, card-face
  metadata, and timing/chart expectation drift.
- After the repository-wide nested-surface sweep commit `df9481f020`, the full
  Vitest suite completed: **2,104 files passed / 600 failed**; **53,020 tests
  passed, 3,861 failed, 4 skipped**, with 3 runner errors. Failures occur
  across unrelated feature areas, including stale evidence-card expectations,
  provider/context setup, chart/jsdom behavior, and localized output checks.
  The failure detail is retained in the run output; triage is pending.
- Phase 7 gates rerun at `df9481f020`: split-i18n check **pass** (57 bundles,
  181 fallbacks, 1,264 shell keys, 0 missing); `npm run lint` **pass**;
  `npx tsc --noEmit` **pass**; `npm run build` **pass**; `go build ./...`
  **pass**; `go test ./...` **pass**. Build reports the existing CSS minifier
  warning (`hue.bg-$`) and startup bundle warning (405.0 KB vs 400 KB budget),
  neither is a build failure.
- User-owned edits in `web/src/api/hooks/useAnalytics.ts` and its test remain
  uncommitted and untouched.
- Full-suite triage fix: unknown EvidencePanel quality codes were incorrectly
  given the danger badge variant. Unknown and absent codes now use the neutral
  variant while recognized `insufficient` remains danger. The matching pending
  Phase 6 item `fix-advanced-road-hazard-mesh-rhm-04` is completed; its focused
  suite passes **20/20**. Commit recorded in `.runner/state.json`.
- Full-suite triage fixed two Helix evidence-trail gaps: recognized tool IDs
  now show translated names while raw IDs remain available in title metadata
  and unknown IDs stay raw; completion summaries use complete localized
  sentences with i18next count plurals. The two corresponding Phase 6 items
  are complete. Split-i18n check passes and the combined focused suites pass
  **58/58**. Changes are in `81c281aa49`.
- A structured full-suite rerun after those fixes is **53,029 passed / 3,852
  failed / 4 skipped** across **2,704 files** (2,107 passed, 597 failed).
  The remaining failures are concentrated in old card-face/missing-metric
  assertions and unrelated Phase 6 contract/catalog fixtures; no production
  type, lint, catalog, build, or Go gate regressed.
- Phase 6 system data-export group: reverified DataExportPage,
  ScheduledExportsPanel, JobProgressDrawer, and RequiresAuth. Focused tests
  pass **151/151**. Updated the DataExport regressions to read retained source
  and per-metric context from the details drawer, and to assert the existing
  explanatory all-metrics-missing state with a reachable history retry. The
  RequiresAuth translation mock now handles the same fallback-string form as
  production. Ten matching system work items are marked done in state.json;
  commit `241c8977e4`.
- Phase 6 system data-repair follow-up: verified scoped scan retention, mutation-family invalidation, scope/write guards, response-authority gating, query-state forwarding, count plurals, and scoped worklist language. Updated older expectations to match the informational no-metric state and details disclosure. Fixed quarantine row expansion by wiring `useTableExpansion`; expanded disclosure regression now passes. Focused suites: hooks **44/44**, queue/quarantine/impact **43/43**, workspace/header/quarantine **75/75**, suggestion/stale-row **45/45**; split-i18n check passes. Seven data-repair items marked done in state.json. Commits: `3a26ac248f`, `cc222f01dd` (plus hook test `d5d6caafd9`).
- Phase 6 system My Activity: the precise start/exclusive-end range regression passes **1/1**; `myActivityAnalytics` and `ActivityTrendPanel` pass **46/46**. Items `ma-01`, `ma-04`, and `ma-10` are done. Items `ma-03` and `ma-06` remain failed after retry: `ma-03` still has legacy KPI assertions expecting standalone metric cards/values for initial unavailable data and “Last active” in a zero-activity case; the current UI uses the shared informational no-metrics brief. `ma-06`'s requested `src/types/admin.test.ts` has five failures in unrelated security helper expectations (boolean parsing, UTC bucket date, and lock-change timestamp), so its DTO reconciliation is unverified. These are recorded with exact failures in state.json.
- Phase 6 system search: backend search race tests pass, API type contracts pass, and `useSearch.test.tsx` passes. Search UI tests still have five failures in `SearchPage.test.tsx` from old summary/card assertions expecting collapsed metrics and retained query/facet scope text on the card face. The implementation now places metric and scope details behind the shared Review details disclosure, and unavailable metrics use the informational state. The three system-search items remain `failed` with this exact verification result in state.json for review.
- Phase 7 gates rerun after the system UI follow-ups: split-i18n catalog check **pass** (57 bundles, 181 fallbacks, 1,266 shell keys, 0 missing); `npm run lint` **pass** (audit chain passes; help-tooltip coverage is 8/9 at its configured floor); `npx tsc --noEmit` **pass**; `npm run build` **pass** (existing CSS minifier warning `hue.bg-$`; namespace audit reports baseline unused entries and source-local dotless labels); `go build ./...` **pass**; `go test ./...` **pass**. Full Vitest: **53,037 passed / 3,847 failed / 4 pending** across **11,392 suites**. The large failure baseline includes UI simplification contract drift (collapsed OperationalBrief metric/detail expectations), catalog fixture contracts, and unrelated existing suites; system-focused failures are listed with exact tests in state.json. Quarantine expansion key typing fix is pushed in `f19ae5dccd`; focused test passes **24/24**.
- Phase 6 system Tesla API usage: `TeslaApiUsagePage.test.tsx` and `RangePicker.test.tsx` passed. `TeslaApiUsageHistory.test.tsx` has 6 failures and `TeslaApiUsageCard.test.tsx` has 9 failures, all from direct card-face assertions for detailed values, source/time metadata, and status that the current shared OperationalBrief reveals through Review details. `tu-04` is done; `tu-01/02/03/07/09/05` remain failed after retry with test names and the shared failure reason recorded in state.json. `tu-10` remains pending because its requested screenshot verification has not yet been captured.
- Phase 6 charging retry: focused requested charging suites totaled **341 passed / 44 failed** across nine files. `useCharging.test.tsx` and `WaitOraclePanel.test.tsx` passed; items `cl03` and `sessions-f10` are done. `sessions-f11` remains pending for screenshot verification; thermal tax and smart-charge tasks remain pending because their required test files were not part of this run. Heatmap pages failed 10 KPI assertions around absent metric wrappers/values; Tesla charging history pages failed 18 assertions (including expected localized date and collapsed metric/status details); Tesla charging sessions failed 16 assertions (missing “Updating.”, “Data unavailable”, and stale-refresh warning in scoped states). The seven linked Phase 6 items are recorded as failed with representative exact errors in state.json.
- Charging thermal-tax and smart-charge retry: ran their required heatmap regression command (both heatmap page suites, data helper, and grid). Helper/grid cases pass, but the page suites retain 10 unavailable/missing-summary card-wrapper assertions; representative failures are a null `[data-operational-metric]` wrapper and missing `Avg Duration` on the collapsed summary. Both items remain failed in state.json with this exact command result.
- Phase 6 battery retry: five focused frontend files total **311 passed / 56 failed**; the four Go race packages (`batterydegradation`, `energy`, `charging`, `drives`) pass. `BatteryDegradationPage.test.tsx` has 42 failures across dates, unknown/invalid values, capacity, predictions and retained states; representative issue is expected calendar-date/value text and old `[data-operational-metric]` wrappers missing from the collapsed shared brief. `EnergyFlowPage.test.tsx` has 9 failures (example: missing “Shared source total”); `VampireDrainPage.test.tsx` has 5 (examples: missing “After unplug” and “Tonight: unknown”). All 11 battery items remain failed after retry with the details in state.json.
- Repository-wide card nesting and duplicate-title sweep revalidated on 2026-10-16. The plan file contains the complete pre-fix AST inventory: 38 standalone brief placements, 26 additional nested bordered surfaces (64 total surface/brief blocks), and 4 duplicate heading/title pairs. The permanent AST test scans all TSX under `src`; `node --test scripts/__tests__/audit-nested-surfaces.test.mjs` passes 2/2 and `node scripts/audit-nested-surfaces.mjs` reports 0 standalone nested briefs, 0 nested bordered surfaces, and 0 duplicate heading/title pairs. Existing exit-check grep covers brief call sites, surface tags/markers, and `maxPerRow`/metric-bank layout.
- Phase 6 Settings verification checkpoint: ran the pending settings suites plus `useSettings.authRecovery.test.tsx`; 713 passed / 47 failed across the batch. Fixed a malformed SignalConfigModal test structure that had nested a Fleet Setup `describe` inside an `it`; all 48 SignalConfigModal tests now pass. Commit `9720fd8719` is pushed. Of 37 pending settings items, 21 verified suites are marked done and 16 remain failed with exact errors in `.runner/state.json`: active sessions (`as-02/03/04/05/06/11`), Fleet Setup auth recovery (`fs013`), Privacy (`privacy-01/02/05`), Helix (`helix-02/03/07/08`), and TOTP flow (`tfa-03/05`). Overall state counts are now 897 done / 161 failed / 218 pending. Key failure clusters are stale card-face expectations after Review details collapsed, the unresolved useSessions active-refetch state, mismatched auth-recovery payload assertion, ambiguous session IP query, and TOTP stale-mode lifecycle assertions.
- Phase 6 Ownership verification checkpoint: ran seven focused ownership suites (276 tests): 183 passed / 93 failed. The one OwnershipPanel failure was a test overreach: it rejected every `role=status`, including the expected actionable successful-empty state. Narrowed it to check for loading/paused notices; OwnershipPanel passes 20/20, pushed in `7f131cfbea`. Remaining recorded failures: InsuranceTelematics 22 (recorded bounds/percentiles queried directly from the collapsed brief); ModelTrust 5 (summary values/details and a duplicate Close query); TariffLab 32 (old Not computed/source/status card-face assertions); WarrantyCommand 19 (editor labels not reached in current flow); OwnershipBrief 14 (recorded bounds/quality details queried without opening Review details). Four items verified done; 22 remain failed with representative errors in state.json. Overall counts: 901 done / 183 failed / 192 pending.
- Phase 6 Notifications verification checkpoint: 15 selected test files totalled 526 tests (469 passed / 57 failed). Marked five items done where all assigned suites passed; 18 items remain failed with suite counts and representative exact failures in `.runner/state.json`. Failures: Archived/Inbox (missing active-lookup/zero-severity details on summary face, dialog state, and metric formatting); channel provider/modal tests (missing French provider label and URL-label lookup); notification health/latency panels (missing stale/detail copy, fatigue denominator/group assertions, and absent `notification-chart-data`). Overall counts: 906 done / 201 failed / 169 pending.
- Phase 6 System verification checkpoint: 18 selected frontend test files totalled 411 tests (388 passed / 23 failed). Eight items are done from passing focused suites; 12 remain failed with exact suite results in state.json; Tesla API usage screenshot item `tu10` stays pending because this batch did not provide browser evidence. State-machine failures: FSMTimelineChart 2 (exact-bound/series markers), StateMachineDebuggerPage 13 (unresolved fetching/paused sections and skeletons), FSMOperationalBrief 2 (source bounds/freshness expected on brief face). System status: SystemStatusPage 1 lingering informational empty-state expectation; StatusHero 5 shared status/shadow selectors. Overall counts: 914 done / 213 failed / 149 pending.
- Phase 6 Telemetry verification checkpoint: 17 selected focused test files totalled 453 tests (386 passed / 67 failed). Seven items are verified done; 17 remain failed with exact suite counts and representative errors in state.json. Failures: LiveSignalTail 2; SignalDiffBreakdown 1; signalCorrelation helper 1; SignalCorrelationPage 10; SignalDeadbandPage 3; SignalDiffPage 9; TelemetrySummaryBrief 20 (source/date/detail values now require opening Review details); CorrelationStatStrip 21 (card-face detail assertions). Overall counts: 921 done / 230 failed / 125 pending.
- Phase 6 Charging follow-up: completed the only remaining pending item, `sessions-f11`. `WaitOraclePanel.test.tsx` passes 43/43 and asserts mobile `min-h-11`/`min-w-11` targets with `md` desktop restoration. Overall counts: 922 done / 230 failed / 124 pending.
- Phase 6 Resale Vault verification checkpoint: seven focused suites totalled 152 tests (134 passed / 18 failed). Six items verified done; five remain failed in state.json. `useVaultEvidence.test.tsx` has 5 lifecycle-state mismatches (active/paused first-read state and successful empty handling); `WarrantyResaleVaultPage.test.tsx` has 13 signing-key recovery/rotation cases where expected actions remain disabled. Overall counts: 928 done / 235 failed / 113 pending.
- Phase 6 Intelligence Packs verification checkpoint: ten selected suites totalled 102 tests (95 passed / 7 failed). Eight items are verified done; three SandboxPreviewPanel items remain failed because each of the seven chart-mode/source-state failures throws Recharts `Could not find Recharts context` in the test render. Exact affected IDs and errors are in state.json. Overall counts: 936 done / 238 failed / 102 pending.
- Phase 6 Diagnostics verification checkpoint: six selected suites totalled 240 tests (184 passed / 56 failed). All nine pending diagnostics items remain failed after this verification retry, with exact suite results in state.json. Failures: RemainingUsefulLife 15 (localized battery labels/source details absent); RootCauseIntelligence page 12 (paused marker/value formatting); ServiceEvidencePack page 9 (graph swatch lookup undefined and timestamp absent); root-cause calculation 3 (leads/concurrent classification and expected 300000 ms versus actual 420000 ms); AnomalyTimelineCard 17 (unit readings absent from rendered card text). Overall counts: 936 done / 247 failed / 93 pending.
- Phase 6 Science verification checkpoint: ScienceLabPage focused suite has 67 tests (26 passed / 41 failed). All nine pending science items remain failed after verification; failures primarily query saved locale/date, source-trust and evidence details directly from the collapsed “Evidence at a glance” brief. Exact representative assertion and suite result are in state.json. Overall counts: 936 done / 256 failed / 84 pending.
- Phase 6 Fleet verification checkpoint: three focused suites totalled 119 tests (111 passed / 8 failed). Six items verified done; three failed. FleetOperationsPage has 7 failures (maintenance cost and Fleet-wide summary assertions against the collapsed brief); fleet helper tests have one timezone mismatch (expected Asia/Tokyo, received America/Los_Angeles). Errors are recorded by ID in state.json. Overall counts: 942 done / 259 failed / 75 pending.
- Phase 6 Service Intelligence verification checkpoint: nine selected suites totalled 179 tests (167 passed / 12 failed). One item verified done; seven remain failed with exact suite breakdowns in state.json: CommunicationsCatalogPanel 7, CommunicationsPanel 3, EvidenceLimitationsPanel 1, WarrantyPanel 1. Failures concern catalog/provider labels and communications/warranty assertions. Overall counts: 943 done / 266 failed / 67 pending.
- Phase 6 i18n verification checkpoint: all eight pending i18n catalog items are done. `node scripts/split-i18n-catalog.mjs --check` passes (57 bundles, 181 fallbacks, 1,266 shell keys, 0 missing); `catalog-split.test.ts` passes 131/131. Overall counts: 951 done / 266 failed / 59 pending.
- Phase 6 Power User verification checkpoint: six selected suites totalled 127 tests (126 passed / 1 failed). Six items are done; Grafana panel item `grafana-panel-f01` remains failed because `GrafanaPanelPage.test.tsx` cannot find the expected “Bundled builder catalog – all entries” content. Overall counts: 957 done / 267 failed / 52 pending.
- Phase 6 Sharing verification checkpoint: three focused suites totalled 88 tests (74 passed / 14 failed). Eleven items verified done; four remain failed. ShareCardPage has one retained-state assertion expecting visible “Cached” on the collapsed brief; SharedDrivePage has 13 failures from duplicate exact metric text and former card-face SI/date/value assertions. Item notes are in state.json. Overall counts: 968 done / 271 failed / 37 pending.
- Phase 6 Home Energy verification checkpoint: ran EnergyFlowChart, useHomeEnergyOrchestration, account-state and KpiSummary suites (42 tests): 32 passed / 10 failed. Two orchestration items are done. Three remain failed: EnergyFlowChart 7 (displayed signed/unknown values and accessible formatter arrays differ), KpiSummary 3 (planning horizon/recommendation/source state are queried from the collapsed brief face). Overall counts: 970 done / 274 failed / 32 pending.
- Phase 6 Automations verification checkpoint: five selected suites totalled 189 tests (177 passed / 12 failed). All four pending automation items remain failed after verification. Failures span AutomationListPage (2), AutomationsListPage (7), and RoutineWizard (3): refetch and malformed-payload state assertions, missing Active row text, and a changed empty-state heading. Representative errors are in state.json. Overall counts: 970 done / 278 failed / 28 pending.
- Phase 6 Server verification checkpoint: all four pending server items are done. Three focused suites (server connection, PageHeader, ConnectPage) pass 74/74. Overall counts: 974 done / 278 failed / 24 pending.
- Phase 6 Watch verification checkpoint: WatchFacePage and AIWatchFaceNLResponse suites totalled 71 tests (69 passed / 2 failed). All three pending Watch items remain failed because the two cache/as-of assertions find duplicate text in visible content plus tooltip text. Overall counts: 974 done / 281 failed / 21 pending.
- Phase 6 Exports verification checkpoint: ExportsPage suite has 41 tests (26 passed / 15 failed). All three pending export items remain failed. Failures include missing accessible export-row names/checkboxes, reversed sort order, and retained/error/paused source states that do not expose expected summary text or null placeholders. Exact test names are retained in the run report and summary in state.json. Overall counts: 974 done / 284 failed / 18 pending.
- Phase 6 Explore verification checkpoint: ExplorePage and featureCatalog suites totalled 92 tests (78 passed / 14 failed). All four pending Explore items remain failed. ExplorePage failures concern paused/unknown fleet marker and count assertions and missing scope/source details before opening Review details. Overall counts: 974 done / 288 failed / 14 pending.
- Phase 6 Analytics verification checkpoint: four selected suites totalled 213 tests (159 passed / 54 failed). Both pending analytics items remain failed. AnalyticsPage has 6 failures (partial/load state copy not found); StatisticsPage has 48, mainly source windows and CO2 methodology expected on the collapsed brief face instead of Review details. Overall counts: 974 done / 290 failed / 12 pending.
- Phase 6 Dashcam verification checkpoint: RedactionEditor, EventEvidencePanel and eventDetection suites totalled 24 tests (23 passed / 1 failed). `dc017` is done; `dc016` remains failed because a saved descriptor containing quotes and an ampersand is not found after locale change. Overall counts: 975 done / 291 failed / 10 pending.

- Phase 6 Driving verification checkpoint: BipolarBar unit/accessibility spacing was fixed in 8666bb2e38; the focused chart, driving type, and driving hook suites pass **186/186**. Trip planner DTO/hook verification, Go race tests, and split-i18n check also pass. Both driving items are done. Overall counts: 977 done / 291 failed / 8 pending.

- Phase 6 remaining departure/browser verification checkpoint (2026-10-16): ChargeDepartureAlignmentPage passes its required colocated suite, covering both timezone/date formatting and numeric formatting items; BrowserPushChannelCard plus both synthetic browser/server push hook suites pass. These three items are done. Retry results: NavigationRoutePage has 10 failing assertions spanning retained recovery, empty states, metrics, measured coordinates, cardinal mapping and independent history; ModelTrustPage has five failures including mobile details/actions and financial/calibration assertions; FeatureFlagsPage has seven save/edit/audit-source failures (its hook suite passes); useOwnership has one governance-run cache invalidation failure. Those four remain failed with exact test summaries recorded in state.json. Tesla API usage 	u10 remains pending until its requested browser screenshot verification. Overall counts: 980 done / 295 failed / 1 pending.


## Final reconciliation (2026-10-16)

Phase 6 is closed for this handoff: **981 done / 295 failed / 0 pending / 0 excluded**. The Tesla API usage screenshot item is done after visual review of 375px and 1440px RangePicker layouts in light and dark theme; mobile trigger measured 44px high, desktop trigger 32px, and keyboard focus/selection passed.

Final gates: split-i18n check **pass** (57 bundles, 181 fallbacks, 1,266 shell keys, 0 missing); `npm run lint` **pass**; `npx tsc --noEmit` **pass**; `npm run build` **pass** (existing CSS minifier warning `hue.bg-$`); `go build ./...` and `go test ./...` **pass**. Full Vitest: **53,079 passed / 3,826 failed / 4 skipped** across 2,705 files (2,117 files passed, 588 failed; 3 runtime errors). This is 21 fewer failures than the previous full run. The all-pages nested-surface contract passes focused (1/1), the AST audit test passes (2/2), and the static audit reports **0 nested standalone briefs / 0 nested bordered surfaces / 0 duplicate heading/title pairs**.

### Excluded items

None.

### Failed Phase 6 items: reason triage (2026-10-16)

The 295-item snapshot is categorized below using the latest recorded retry/checkpoint, not the first historical failure. Categories describe recorded evidence, not confirmed production bugs. The 110 historical/incomplete records do not prove a current dependency or toolchain outage: current catalog, lint, typecheck, build and Go gates pass. Their acceptance still needs reconciliation with current regression results. No item status was changed by this classification.

| Recorded reason category | Items |
| --- | ---: |
| Historical tooling or incomplete verification record | 110 |
| Source, mutation or interaction state assertions | 81 |
| Redesign disclosure or metric presentation assertions | 68 |
| Locale, formatting or copy assertions | 16 |
| Fixture or chart contract mismatch | 9 |
| Ambiguous text or role queries | 7 |
| Domain or UI assertions requiring diagnosis | 4 |
| **Total** | **295** |

#### Historical tooling or incomplete verification record (110)

- `fix-admin-feedback-queue-fq005`: Historical record: Required wiring is outside permitted scope: FeedbackQueuePage does not pass canStart, and shared AIFeedbackQueueTriage has no canStart prop; conditional unmounting hides retained advice
- `fix-admin-fleet-telemetry-coverage-f04`: Historical record: validation exceeded time box
- `fix-admin-gas-price-auto-poll-gas-03`: Historical record: Focused npx vitest run and direct runner retry stalled without output; stopped both, verification incomplete
- `fix-admin-gas-price-auto-poll-gas-05`: Historical record: verification commands stalled without output
- `fix-admin-vehicle-cost-f03`: Historical record: Exact upper-bound filtering requires backend edits explicitly forbidden by the prompt: handler accepts only since and both SQL paths lack an upper bound
- `fix-admin-ingest-xray-xray-01`: Historical record: display requires out-of-scope changes; focused verification stalled
- `fix-admin-live-signal-inspector-lsi-06`: Historical record: frontend regression tests stalled before producing output
- `fix-admin-redis-signal-viewer-f01`: Historical record: scoped tests stalled without output; behavior verification incomplete
- `fix-admin-redis-signal-viewer-f03`: Historical record: scoped tests blocked before collection by external generated-catalog failure
- `fix-admin-redis-signal-viewer-f09`: Historical record: focused test verification incomplete within time box; local tools exist, so broken dependencies are not established
- `fix-admin-redis-signal-viewer-f06`: Historical record: shared-type edit prohibition blocks typed adapter alignment
- `fix-admin-slow-queries-sq-002`: Historical record: regression and browser verification blocked by unresponsive commands
- `fix-admin-vehicle-cost-f06`: Historical record: browser layout verification and final catalog check incomplete within time box
- `fix-advanced-behavioral-sentinel-bs003`: Historical record: Focused regressions did not finish within time box
- `fix-advanced-charging-forensics-cf-03`: Historical record: scoped tests blocked by external catalog validation; Edge layout checks timed out
- `fix-advanced-emergency-resilience-er-f03`: Historical record: targeted tests blocked before collection by external locale-battery.json catalog preflight failure
- `fix-advanced-emergency-resilience-er-f05`: Historical record: focused verification blocked by external i18n catalog startup failure
- `fix-advanced-emergency-resilience-er-f06`: Historical record: command execution unavailable; verification blocked
- `fix-advanced-federated-learning-fl003`: Historical record: verification blocked by stalled test and catalog commands
- `fix-advanced-federated-learning-fl005`: Historical record: validation runners stalled without output
- `fix-advanced-twin-lab-f04`: Historical record: external catalog validation blocked test startup
- `fix-advanced-twin-lab-f05`: Historical record: runtime verification blocked
- `fix-analytics-analytics-f05`: Historical record: required frontend regressions blocked by external i18n catalog startup failure
- `fix-analytics-analytics-f07`: Historical record: Required validation blocked by unavailable/stalled PowerShell execution
- `fix-analytics-analytics-f10`: Historical record: required tests stalled without output; completion unverified
- `fix-analytics-analytics-f11`: Historical record: missing dependencies block tests, catalog regeneration/check and typecheck; restoration failed twice
- `fix-analytics-drive-archetypes-da-003`: Historical record: Targeted Vitest and TypeScript stalled without verification results, including direct Vitest execution
- `fix-analytics-drive-calendar-dc01`: Historical record: Required regression blocked before collection by external i18n catalog validation
- `fix-analytics-drive-calendar-dc05`: Historical record: command execution stalled without output, blocking regression tests and catalog regeneration/check
- `fix-analytics-fleet-compare-f08`: Historical record: verification exceeded time box; initial test startup failed on external catalog drift, regenerated --check and scoped test retry did not finish
- `fix-analytics-fleet-compare-f09`: Historical record: focused Vitest stalled without output for 120 seconds via both npx and direct local invocation; verification blocked
- `fix-analytics-lifetime-stats-ls-03`: Historical record: focused regression execution stalled without output
- `fix-analytics-lifetime-stats-ls-04`: Historical record: weekday identity absent from assigned component; verification blocked by external catalog drift
- `fix-analytics-mileage-f02`: Historical record: required test startup stalled; browser verification blocked by onboarding redirect
- `fix-analytics-statistics-stat-qa-03`: Historical record: prerequisite state hook/key bounds support missing outside assigned scope
- `fix-analytics-statistics-stat-qa-06`: Historical record: required tests blocked by external i18n catalog startup failure
- `fix-analytics-timeline-tl-05`: Historical record: focused tests blocked before collection by external i18n catalog validation
- `fix-analytics-true-cost-tc-qa-01`: Historical record: targeted tests blocked by external generated-catalog startup failure
- `fix-analytics-true-cost-tc-qa-06`: Historical record: required full-file verification incomplete
- `fix-analytics-true-cost-tc-qa-02`: Historical record: required Vitest verification stalled within time box
- `fix-analytics-weekly-digest-wd-qa-01`: Historical record: required regression validation could not complete because command execution stalled
- `fix-analytics-weekly-digest-wd-qa-02`: Historical record: regression verification stalled without results
- `fix-analytics-year-review-f08`: Historical record: required frontend verification blocked by external generated-catalog startup failure
- `fix-automations-automation-list-al-s01`: Historical record: required frontend tests blocked before collection by external generated i18n catalog drift
- `fix-automations-automation-list-al-s07`: Historical record: focused regression execution blocked by external i18n catalog validation
- `fix-automations-automation-list-al-s08`: Historical record: required verification blocked by unavailable PowerShell
- `fix-automations-automations-list-f01`: Historical record: required frontend regression blocked by external i18n startup failure
- `fix-automations-automation-list-al-s03`: Historical record: recovery test failed; four-file verification incomplete within time box
- `fix-automations-automations-list-f08`: Historical record: missing existing duplicate/export contracts and builder draft handoff outside assigned scope
- `fix-automations-automation-history-ahqa-08`: Historical record: scoped Vitest execution stalled without output
- `fix-battery-battery-degradation-bd-01`: Historical record: shared energy-type alignment remains incomplete and prohibited by prompt
- `fix-battery-battery-degradation-bd-02`: Historical record: frontend verification blocked by external generated-i18n startup failure and stalled checks
- `fix-battery-battery-passport-f04`: Historical record: tests blocked before collection by external generated-i18n validation failure
- `fix-battery-battery-passport-f07`: Historical record: validation runners stalled without results
- `fix-battery-cells-bc-qa-008`: Historical record: required frontend tests blocked before collection by external generated i18n catalog validation
- `fix-battery-charge-advisor-ca-s05`: Historical record: complete energy filtering requires prohibited backend edits; test execution blocked by unavailable PowerShell
- `fix-battery-charge-advisor-ca-s10`: Historical record: focused Vitest verification blocked by nonresponsive shell
- `fix-battery-power-flow-dashboard-f01`: Historical record: required server changes prohibited by web-only rule
- `fix-battery-sleep-efficiency-q01`: Historical record: required backend filtering conflicts with explicit web-only edit restriction
- `fix-battery-energy-flow-f03`: Historical record: Required Vitest blocked before test execution by external generated-catalog validation
- `fix-battery-energy-flow-f05`: Historical record: verification incomplete within time box; page test visibility assertion failed
- `fix-battery-power-flow-dashboard-f06`: Historical record: validation stalled without test output using both npx and the direct local Vitest runner; stopped both processes
- `fix-battery-projected-range-prange-qa-006`: Historical record: focused test stalled; catalog freshness check failed
- `fix-battery-sleep-efficiency-q08`: Historical record: scoped tests blocked by external generated-i18n catalog startup failure; no tests executed
- `fix-battery-sleep-efficiency-q14`: Historical record: focused tests blocked by external generated-catalog startup failure
- `fix-battery-vampire-drain-vd05`: Historical record: scoped verification stalled without output
- `fix-battery-vampire-drain-vd06`: Historical record: tests stalled and browser checks blocked
- `fix-charging-charge-interruption-f3`: Historical record: focused regression blocked by catalog validation; retries exceeded remaining time
- `fix-charging-charging-detail-f04`: Historical record: external catalog startup failure prevented test execution
- `fix-charging-charging-detail-f05`: Historical record: required suite blocked by catalog drift; isolated suite has two unrelated distance failures
- `fix-charging-charging-detail-f09`: Historical record: verification incomplete due to external catalog drift and time box
- `fix-charging-charging-heatmap-chh003`: Historical record: verification blocked by external i18n catalog startup failure
- `fix-charging-charging-heatmap-chh004`: Historical record: scoped regression execution blocked by external i18n catalog startup failure
- `fix-charging-tesla-charging-history-th02`: Historical record: required tests stalled without output
- `fix-charging-tesla-charging-history-th03`: Historical record: focused tests could not execute: shell startup failure and direct runner stalled
- `fix-charging-tesla-charging-history-th04`: Historical record: targeted Vitest blocked by external catalog validation; behavior unverified
- `fix-charging-tesla-charging-history-th07`: Historical record: validation blocked by PowerShell startup timeout and unresponsive catalog command
- `fix-charging-tesla-charging-sessions-f02`: Historical record: Backend GET lacks date-bound support outside allowed scope; focused tests stalled
- `fix-charging-tesla-charging-sessions-f03`: Historical record: focused Vitest verification stalled without results
- `fix-charging-charging-list-cl14`: Historical record: focused tests blocked by external i18n catalog startup failure
- `fix-charging-charging-list-cl16`: Historical record: verification exceeded timebox
- `fix-charging-charging-thermal-tax-ctt-h01`: Historical record: CHECKPOINT 2026-10-15: thermal-tax page + modernization suites passed (5 files, 42 tests); individual item acceptance remains open.
- `fix-charging-charging-thermal-tax-ctt-h03`: Historical record: CHECKPOINT 2026-10-15: thermal-tax page + modernization suites passed (5 files, 42 tests); individual item acceptance remains open.
- `fix-charging-charging-thermal-tax-ctt-s05`: Historical record: CHECKPOINT 2026-10-15: thermal-tax page + modernization suites passed (5 files, 42 tests); individual item acceptance remains open.
- `fix-charging-cost-analysis-ca04`: Historical record: CHECKPOINT 2026-10-15: full cost-analysis area passed (17 files, 280 tests); individual item acceptance remains open.
- `fix-charging-cost-analysis-ca08`: Historical record: CHECKPOINT 2026-10-15: full cost-analysis area passed (17 files, 280 tests); individual item acceptance remains open.
- `fix-charging-cost-analysis-ca06`: Historical record: CHECKPOINT 2026-10-15: full cost-analysis area passed (17 files, 280 tests); individual item acceptance remains open.
- `fix-charging-cost-analysis-ca13`: Historical record: CHECKPOINT 2026-10-15: full cost-analysis area passed (17 files, 280 tests); individual item acceptance remains open.
- `fix-charging-smart-charge-sc-f04`: Historical record: targeted tests stalled without output
- `fix-charging-smart-charge-sc-f08`: Historical record: external i18n catalog startup failure prevented regression verification
- `fix-charging-smart-charge-sc-f10`: Historical record: command execution unavailable; required test and browser verification blocked
- `fix-charging-smart-charge-sc-f06`: Historical record: Attempt 1: timeout after 25 minutes (changes left on disk) Attempt 2: timeout after 25 minutes (changes left on disk)
- `fix-charging-tesla-charging-sessions-f12`: Historical record: focused Vitest run stalled without output
- `fix-charging-tesla-charging-sessions-f07`: Historical record: targeted tests blocked by external i18n startup failure
- `fix-dashboard-glance-f02`: Historical record: scoped Vitest stalled; no test results or exit code
- `fix-dashboard-glance-f04`: Historical record: scoped tests stalled and onboarding redirects blocked browser verification
- `fix-dashboard-quick-stats-qs-004`: Historical record: verification blocked by external generated-i18n startup failure
- `fix-dashboard-quick-stats-qs-002`: Historical record: scoped verification stalled without output; no test exit status available
- `fix-dashcam-dashcam-intelligence-dc002`: Historical record: verification blocked by command execution timeouts
- `fix-dashcam-dashcam-intelligence-dc012`: Historical record: command execution unavailable; required regeneration and tests unverified
- `fix-dashcam-dashcam-intelligence-dc014`: Historical record: Scoped test and browser verification incomplete within time limit
- `fix-dashcam-dashcam-intelligence-dc011`: Historical record: regression and catalog check incomplete within time box; external TypeScript failures
- `fix-diagnostics-root-cause-intelligence-rc04`: Historical record: scoped test execution stalled without output
- `fix-diagnostics-service-evidence-pack-sep-source-004`: Historical record: dependencies broken: targeted Vitest and direct runner stalled without output; verification could not complete
- `fix-dashcam-dashcam-intelligence-dc015`: Historical record: Required focused Vitest command stalled without output; verification remains incomplete
- `fix-diagnostics-anomaly-dashboard-f01`: Historical record: required verification blocked by PowerShell startup timeouts and stalled commands
- `fix-diagnostics-anomaly-dashboard-f03`: Historical record: required frontend verification blocked by external i18n catalog startup failure
- `fix-diagnostics-remaining-useful-life-rul-01`: Historical record: focused regression verification incomplete
- `fix-diagnostics-remaining-useful-life-rul-03`: Historical record: Required scoped tests stalled without output using both npx and direct local Vitest; verification incomplete
- `fix-diagnostics-root-cause-intelligence-rc06`: Historical record: required regression blocked by unavailable/unresponsive PowerShell

#### Source, mutation or interaction state assertions (81)

- `fix-automations-automations-list-f03`: Retry failed: automation selected suites have 12 failures across AutomationListPage (2), AutomationsListPage (7), and RoutineWizard (3). Examples: active-refetch never reaches expected state, malformed catalog payload fails to reject as expected, no Active row text, and RoutineWizard expected section heading is replaced by the current empty-state explanation.
- `fix-automations-automations-list-f05`: Retry failed: automation selected suites have 12 failures across AutomationListPage (2), AutomationsListPage (7), and RoutineWizard (3). Examples: active-refetch never reaches expected state, malformed catalog payload fails to reject as expected, no Active row text, and RoutineWizard expected section heading is replaced by the current empty-state explanation.
- `fix-automations-automation-list-al-s04`: Retry failed: automation selected suites have 12 failures across AutomationListPage (2), AutomationsListPage (7), and RoutineWizard (3). Examples: active-refetch never reaches expected state, malformed catalog payload fails to reject as expected, no Active row text, and RoutineWizard expected section heading is replaced by the current empty-state explanation.
- `fix-automations-automation-list-al-s06`: Retry failed: automation selected suites have 12 failures across AutomationListPage (2), AutomationsListPage (7), and RoutineWizard (3). Examples: active-refetch never reaches expected state, malformed catalog payload fails to reject as expected, no Active row text, and RoutineWizard expected section heading is replaced by the current empty-state explanation.
- `fix-charging-charging-thermal-tax-ctt-s01`: Retry verification failed 2026-10-15: required charging heatmap regression command ran, but the two ChargingHeatmapPage suites contain 10 failing assertions about unavailable/missing-summary card wrappers (suite total 341 passed/44 failed). Underlying helper/grid tests pass; reported first errors are `toHaveAttribute` receiving null for missing metric state and unable to find visible `Avg Duration` in summary.
- `fix-charging-smart-charge-sc-f01`: Retry verification failed 2026-10-15: required charging heatmap regression command ran, but the two ChargingHeatmapPage suites contain 10 failing assertions about unavailable/missing-summary card wrappers (suite total 341 passed/44 failed). Underlying helper/grid tests pass; reported first errors are `toHaveAttribute` receiving null for missing metric state and unable to find visible `Avg Duration` in summary.
- `fix-charging-tesla-charging-sessions-f15`: Retry verification failed 2026-10-15: TeslaChargingSessionsPage.test.tsx reports 16 failures. Representative exact errors: cannot find “Updating.”, “Data unavailable”, or `[data-testid="stale-refresh-warning"]` in scoped/unavailable/retained cases.
- `fix-diagnostics-service-evidence-pack-sep-source-009`: Retry failed: ServiceEvidencePackPage.test.tsx has 9 failures; snapshot timestamp and source details are not visible on the summary face.
- `fix-diagnostics-anomaly-dashboard-f05`: Retry failed: AnomalyTimelineCard.test.tsx has 17 failures; authoritative readings/units (for example 0.5 km and -4.5 km/h) are not present in the visible card text.
- `fix-diagnostics-root-cause-intelligence-rc05`: Retry failed: rootCauseIntelligence.test.ts has 3 failures; expected leads/concurrent classification differs and expected 300000 ms is 420000 ms.
- `fix-diagnostics-service-evidence-pack-sep-source-006`: Retry failed: rootCauseIntelligence.test.ts has 3 failures; expected leads/concurrent classification differs and expected 300000 ms is 420000 ms.
- `fix-exports-exports-ex03`: Retry failed: ExportsPage.test.tsx has 15 failures across 41 tests. Breakage includes missing accessible export-row names/checkboxes, reversed sort order, and retained/error/paused states not exposing expected summary text or null-value placeholders.
- `fix-exports-exports-ex05`: Retry failed: ExportsPage.test.tsx has 15 failures across 41 tests. Breakage includes missing accessible export-row names/checkboxes, reversed sort order, and retained/error/paused states not exposing expected summary text or null-value placeholders.
- `fix-exports-exports-ex07`: Retry failed: ExportsPage.test.tsx has 15 failures across 41 tests. Breakage includes missing accessible export-row names/checkboxes, reversed sort order, and retained/error/paused states not exposing expected summary text or null-value placeholders.
- `fix-fleet-ops-fleet-operations-f01`: Retry failed: FleetOperationsPage.test.tsx has 7 failures; direct assertions cannot find Maintenance cost in the brief face, and Fleet-wide/cost summary expectations differ from current summary rendering.
- `fix-home-energy-whole-home-energy-f06`: Retry failed: EnergyFlowChart.test.tsx has 7 failures; accessible/unknown measurements do not match expected unrounded numeric/sign display arrays.
- `fix-maps-navigation-route-nav-qa-005`: RETRY FAILED | NavigationRoutePage.test.tsx: 10 failures across retained refresh/recovery, route metrics, empty sections, measured zero coordinates, heading cardinal and independent-source availability assertions. Existing UI assertions diverge after modernization; individual failing test names in run output from 2026-10-16.
- `fix-notifications-archived-f08`: Retry failed: InboxBody.test.tsx has 8 failures; archived mode severity/details and responsive dialog assertions do not match current brief/dialog rendering.
- `fix-notifications-channels-nc011`: Retry failed: ChannelFormModal.test.tsx has 3 failures; create-mode tests cannot find the URL label in the modal.
- `fix-notifications-channels-nc013`: Retry failed: ChannelFormModal.test.tsx has 3 failures; create-mode URL validation/label assertions fail because the URL label is not found.
- `fix-notifications-channels-nc014`: Retry failed: ChannelFormModal.test.tsx has 3 failures; create-mode URL validation/label assertions fail because the URL label is not found.
- `fix-notifications-channels-nc015`: Retry failed: ChannelFormModal.test.tsx has 3 failures; create-mode URL validation/label assertions fail because the URL label is not found.
- `fix-notifications-notification-health-nh-02`: Retry failed: NotificationHealthPanels.continuation.test.tsx has 18 failures; stale warning, fatigue denominators and full table grouping assertions differ from rendered output.
- `fix-notifications-notification-health-nh-04`: Retry failed: NotificationHealthPanels.continuation.test.tsx has 18 failures; expected fatigue caption “of 1 rules” and other labels are not found.
- `fix-notifications-notification-health-nh-07`: Retry failed: NotificationHealthPanels.continuation.test.tsx has 18 failures; composite fatigue/grouping and retained-detail assertions differ from current output.
- `fix-notifications-notification-health-nh-09`: Retry failed: NotificationHealthPanels.continuation.test.tsx has 18 failures; section population and source-retention assertions fail.
- `fix-notifications-notification-health-nh-11`: Retry failed: NotificationHealthPanels.continuation.test.tsx has 18 failures; full grouping/denominator and retained-detail assertions fail.
- `fix-ownership-model-trust-mt03`: Retry failed: ModelTrustPage.test.tsx has 5 failures; tests expect portfolio band and selected-model score details on the summary face.
- `fix-ownership-warranty-command-wc-08`: Retry failed: WarrantyCommandPage.test.tsx has 19 failures; coverage/claim editor labels are unavailable in current test flow before assertions.
- `fix-ownership-warranty-command-wc-04`: Retry failed: WarrantyCommandPage.test.tsx has 19 failures; battery retention/headroom details fail their existing page assertions.
- `fix-ownership-warranty-command-wc-03`: Retry failed: WarrantyCommandPage.test.tsx has 19 failures; mobile details/action coverage does not reach expected editor labels.
- `fix-ownership-warranty-command-wc-01`: Retry failed: WarrantyCommandPage.test.tsx has 19 failures; draft-scope cases cannot find coverage/claim editor labels in the current flow.
- `fix-power-user-grafana-panel-f01`: Retry failed: GrafanaPanelPage.test.tsx cannot find Bundled builder catalog – all entries in the static catalog evidence section; 1 failure.
- `fix-resale-vault-warranty-resale-vault-f09`: Retry failed: useVaultEvidence.test.tsx has 5 lifecycle failures: active first read is reported as not loading, paused first read does not remain pending, and successful empty/zero data expectations disagree with the combined hook state.
- `fix-resale-vault-warranty-resale-vault-f11`: Retry failed: WarrantyResaleVaultPage.test.tsx has 13 failures; signing-key actions stay disabled in automatic-generation, rotation, and stale vehicle-scope cases.
- `fix-resale-vault-warranty-resale-vault-f10`: Retry failed: WarrantyResaleVaultPage.test.tsx has 13 failures; signing-key actions stay disabled in rotation and stale vehicle-scope cases.
- `fix-resale-vault-warranty-resale-vault-f01`: Retry failed: WarrantyResaleVaultPage.test.tsx has 13 failures; signing-key recovery actions remain disabled after automatic key generation rejects.
- `fix-resale-vault-warranty-resale-vault-f02`: Retry failed: WarrantyResaleVaultPage.test.tsx has 13 failures; signing-key recovery actions remain disabled through stale vehicle scope changes.
- `fix-service-intelligence-service-intelligence-si11`: Retry failed: CommunicationsCatalogPanel.test.tsx has 7 failures in translated provider/catalog labels and rendering.
- `fix-service-intelligence-service-intelligence-si09`: Retry failed: service-intelligence selected suites have 12 failures across CommunicationsCatalogPanel (7), CommunicationsPanel (3), EvidenceLimitationsPanel (1), and WarrantyPanel (1).
- `fix-service-intelligence-service-intelligence-si08`: Retry failed: service-intelligence selected suites have 12 failures across communications catalog/panel, evidence limitations, and WarrantyPanel assertions.
- `fix-service-intelligence-service-intelligence-si06`: Retry failed: CommunicationsCatalogPanel.test.tsx has 7 failures in translated provider/catalog labels and rendering.
- `fix-service-intelligence-service-intelligence-si04`: Retry failed: WarrantyPanel.test.tsx has 1 failure in its focused warranty assertion; related suite reports 12 failures total.
- `fix-service-intelligence-service-intelligence-si03`: Retry failed: WarrantyPanel.test.tsx has 1 failure in its focused warranty assertion; related suite reports 12 failures total.
- `fix-service-intelligence-service-intelligence-si01`: Retry failed: CommunicationsPanel.test.tsx has 3 failures in communications status/detail assertions.
- `fix-settings-active-sessions-as-11`: Retry failed: useSessions.test.tsx does not observe isRefetching=true in the active-refresh case (line 220); 1 failure.
- `fix-settings-active-sessions-as-06`: Retry failed: same useSessions.test.tsx active-refresh case does not observe isRefetching=true; 1 failure.
- `fix-settings-active-sessions-as-05`: Retry failed: same useSessions.test.tsx active-refresh case does not observe isRefetching=true; 1 failure.
- `fix-settings-fleet-setup-fs013`: Retry failed: useSettings.authRecovery.test.tsx historical-view/sudo replay expects {auth_url}; actual response differs (deep-equality mismatch at line 105).
- `fix-settings-helix-helix-03`: Retry failed: AISettings.test.tsx has 7 failures; tests expect data-testid ai-settings-unsaved but the current component does not render it.
- `fix-settings-helix-helix-02`: Retry failed: AISettings.test.tsx has 7 failures; tests expect data-testid ai-settings-unsaved but the current component does not render it.
- `fix-settings-helix-helix-07`: Retry failed: AIUsageCard.test.tsx has 5 failures; tests expect three dash values and visible Last updated metadata on the brief face.
- `fix-settings-privacy-privacy-05`: Retry failed: PrivacyPage.test.tsx has 9 failures, including legacy KPI/detail assertions and missing Deployment policy unavailable copy in unknown/failure scenarios.
- `fix-settings-privacy-privacy-02`: Retry failed: PrivacyPage.test.tsx has 9 failures, including expected date-range explanation and a four-entry panel where only three render.
- `fix-settings-two-factor-auth-tfa-05`: Retry failed: useTotpEnrollmentFlow.test.tsx has 8 stale-lifecycle failures after status mode changes during pending work; confirm/dialog state differs from close/reset expectations.
- `fix-settings-two-factor-auth-tfa-03`: Retry failed: useTotpEnrollmentFlow.test.tsx has 8 stale-lifecycle failures; stale completion after a status mode change interferes with the newer flow expected state.
- `fix-telemetry-signal-correlation-sc-01`: Retry failed: SignalCorrelationPage.test.tsx has 10 failures in the correlation page assertions.
- `fix-telemetry-signal-change-points-scp002`: Retry failed: TelemetrySummaryBrief.test.tsx has 20 failures; the brief face no longer exposes the source/date/metric fields asserted directly by these tests.
- `fix-telemetry-signal-deadband-f002`: Retry failed: TelemetrySummaryBrief.test.tsx has 20 failures; direct brief-face source/date/metric assertions are missing.
- `fix-system-my-activity-ma-06`: Retry verification failed 2026-10-15: src/types/admin.test.ts has 5 failures: doorClosed/isSentryActive/allWindowsClosed return null for expected booleans; buildSentryBuckets returns 2023-12-31 instead of 2024-01-01; findLastLockChange returns 01:00Z instead of 00:00Z. These do not validate the listed DTO reconciliation.
- `fix-system-state-machine-debugger-f02`: Retry failed: state-machine focused suites have 23 failures. FSMTimelineChart has 2 failures (exact-bound memoization returned undefined and expected series markers are missing); both StateMachineDebuggerPage suites fail fetching/paused unresolved-transition and skeleton assertions.
- `fix-system-state-machine-debugger-f03`: Retry failed: StateMachineDebuggerPage suites fail fetching/paused unresolved-transition assertions and skeleton assertions; 13 page assertions fail across the two test files.
- `fix-system-state-machine-debugger-f05`: Retry failed: StateMachineDebuggerPage suites fail fetching/paused unresolved-transition assertions and skeleton assertions; 13 page assertions fail across the two test files.
- `fix-system-state-machine-debugger-f06`: Retry failed: StateMachineDebuggerPage suites fail fetching/paused unresolved-transition assertions and skeleton assertions; 13 page assertions fail across the two test files.
- `fix-system-state-machine-debugger-f11`: Retry failed: StateMachineDebuggerPage suites fail fetching/paused unresolved-transition assertions and skeleton assertions; 13 page assertions fail across the two test files.
- `fix-telemetry-live-signal-monitor-lsm-f03`: Retry failed: LiveSignalTail.test.tsx has 2 failures in retained/live signal tail behavior.
- `fix-telemetry-signal-correlation-sc-02`: Retry failed: SignalCorrelationPage.test.tsx and signalCorrelation.test.ts have 11 failures across page source/range and calculation contracts.
- `fix-telemetry-signal-correlation-sc-05`: Retry failed: SignalCorrelationPage.test.tsx and signalCorrelation.test.ts have 11 failures across page source/range and calculation contracts.
- `fix-telemetry-signal-correlation-sc-07`: Retry failed: SignalCorrelationPage.test.tsx has 10 failures in the page source/range assertions.
- `fix-telemetry-signal-correlation-sc-06`: Retry failed: SignalCorrelationPage.test.tsx and signalCorrelation.test.ts have 11 failures across page source/range and calculation contracts.
- `fix-telemetry-signal-deadband-f005`: Retry failed: SignalDeadbandPage.test.tsx has 3 failures in deadband page assertions.
- `fix-telemetry-signal-diff-sd-01`: Retry failed: SignalDiffPage.test.tsx and SignalDiffBreakdown.test.tsx have 10 failures, including unavailable breakdown data and page detail assertions.
- `fix-telemetry-signal-diff-sd-02`: Retry failed: SignalDiffPage.test.tsx has 9 failures in signal-diff page assertions.
- `fix-telemetry-signal-diff-sd-03`: Retry failed: SignalDiffPage.test.tsx and SignalDiffBreakdown.test.tsx have 10 failures, including unavailable breakdown data and page detail assertions.
- `fix-telemetry-signal-diff-sd-07`: Retry failed: SignalDiffPage.test.tsx has 9 failures in signal-diff page assertions.
- `fix-telemetry-signal-diff-sd-08`: Retry failed: SignalDiffPage.test.tsx has 9 failures in signal-diff page assertions.
- `fix-telemetry-signal-diff-sd-11`: Retry failed: SignalDiffBreakdown.test.tsx has one failure in diff breakdown output.
- `fix-telemetry-signal-diff-sd-12`: Retry failed: SignalDiffPage.test.tsx and SignalDiffBreakdown.test.tsx have 10 failures, including unavailable breakdown data and page detail assertions.
- `fix-model-trust-mobile-regression-fixture`: RETRY FAILED | ModelTrustPage.test.tsx: 5 failures remain, including mobile details/actions and financial history/calibration assertions; required mobile fixture behavior is not verified.
- `fix-feature-flag-delete-result-feedback`: RETRY FAILED | FeatureFlagsPage.test.tsx: 7 failures in save/drawer pending/rejection handling, edit mode and partial audit-source state. useFeatureFlags.test.tsx passes.
- `fix-governance-run-cache-invalidation`: RETRY FAILED | useOwnership.test.tsx: governance run-cache invalidation test fails its requirement to preserve cache and avoid refetch on failed mutation.

#### Redesign disclosure or metric presentation assertions (68)

- `fix-analytics-analytics-f12`: Retry failed: AnalyticsPage.test.tsx has 6 failures for partial-source/load state copy and Analytics/Statistics suites include collapsed-brief details missing on the face.
- `fix-analytics-statistics-stat-qa-08`: Retry failed: StatisticsPage.test.tsx has 48 failures; mixed-window, CO2 methodology and other source/context details are expected on the card face but are behind Review details.
- `fix-battery-battery-degradation-bd-03`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-05`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-06`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-07`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-08`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-09`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-10`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-11`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-battery-degradation-bd-13`: Retry verification failed 2026-10-15: BatteryDegradationPage.test.tsx has 42 failing assertions (date preference, unknown/invalid health, capacity/source, prediction and retained-source cases). Representative exact assertion: `expect(element).toHaveTextContent()` fails in the America/Los_Angeles calendar-day case; multiple cases cannot locate the old `[data-operational-metric]` wrappers inside the collapsed shared brief. Race Go package test passes.
- `fix-battery-energy-flow-f01`: Retry verification failed 2026-10-15: EnergyFlowPage.test.tsx has 9 failures. Representative error: cannot find “Shared source total” in the collapsed summary; 5 focused files total 311 passed / 56 failed. `workspaceScope`, `useDriving`, and Go race packages pass.
- `fix-battery-vampire-drain-vd08`: Retry verification failed 2026-10-15: VampireDrainPage.test.tsx has 5 failures. Representative exact error: cannot find “After unplug” in the page review surface; tests also cannot find “Tonight: unknown”, expected stale warning, and retained metrics in collapsed brief. Go race packages pass.
- `fix-charging-tesla-charging-history-th05`: Retry verification failed 2026-10-15: TeslaChargingHistoryPage and __tests__/TeslaChargingHistoryPage report 18 failing assertions. Representative exact errors: cannot find expected localized date text “31. Jan. 2024, 16:30”; summary details/status text and absent-metric card selectors are not found under the current shared Review details brief.
- `fix-charging-tesla-charging-history-th06`: Retry verification failed 2026-10-15: TeslaChargingHistoryPage and __tests__/TeslaChargingHistoryPage report 18 failing assertions. Representative exact errors: cannot find expected localized date text “31. Jan. 2024, 16:30”; summary details/status text and absent-metric card selectors are not found under the current shared Review details brief.
- `fix-charging-tesla-charging-history-th08`: Retry verification failed 2026-10-15: TeslaChargingHistoryPage and __tests__/TeslaChargingHistoryPage report 18 failing assertions. Representative exact errors: cannot find expected localized date text “31. Jan. 2024, 16:30”; summary details/status text and absent-metric card selectors are not found under the current shared Review details brief.
- `fix-charging-tesla-charging-history-th10`: Retry verification failed 2026-10-15: TeslaChargingHistoryPage and __tests__/TeslaChargingHistoryPage report 18 failing assertions. Representative exact errors: cannot find expected localized date text “31. Jan. 2024, 16:30”; summary details/status text and absent-metric card selectors are not found under the current shared Review details brief.
- `fix-charging-tesla-charging-history-th12`: Retry verification failed 2026-10-15: TeslaChargingHistoryPage and __tests__/TeslaChargingHistoryPage report 18 failing assertions. Representative exact errors: cannot find expected localized date text “31. Jan. 2024, 16:30”; summary details/status text and absent-metric card selectors are not found under the current shared Review details brief.
- `fix-explore-explore-f02`: Retry failed: ExplorePage.test.tsx has 14 failures. Paused/unknown fleet tests cannot find Vehicles or expected data-state markers; built-in details assertions cannot find scope/source text. Current page brief renders a reduced summary face with details behind Review details.
- `fix-explore-explore-f03`: Retry failed: ExplorePage.test.tsx has 14 failures. Paused/unknown fleet tests cannot find Vehicles or expected data-state markers; built-in details assertions cannot find scope/source text. Current page brief renders a reduced summary face with details behind Review details.
- `fix-explore-explore-f04`: Retry failed: ExplorePage.test.tsx has 14 failures. Paused/unknown fleet tests cannot find Vehicles or expected data-state markers; built-in details assertions cannot find scope/source text. Current page brief renders a reduced summary face with details behind Review details.
- `fix-explore-explore-f06`: Retry failed: ExplorePage.test.tsx has 14 failures. Paused/unknown fleet tests cannot find Vehicles or expected data-state markers; built-in details assertions cannot find scope/source text. Current page brief renders a reduced summary face with details behind Review details.
- `fix-home-energy-whole-home-energy-f10`: Retry failed: KpiSummary.test.tsx has 3 failures; planning horizon, modeled recommendation and essential-source status are expected on the brief face but are currently hidden in Review details.
- `fix-notifications-archived-f01`: Retry failed: ArchivedPage.test.tsx has 2 failures: active-lookup loading assertion is missing and confirmed zero severity count is not found on the collapsed summary face.
- `fix-notifications-archived-f05`: Retry failed: ArchivedPage.test.tsx and InboxBody.test.tsx fail 10 cases; severity/count details and archived semantics are asserted on the card face, and archived activation dialog remains open in one case.
- `fix-ownership-insurance-telematics-f01`: Retry failed: InsuranceTelematicsPage.test.tsx has 22 failures, including missing Recorded bounds/percentile metrics from direct summary-card-face queries; details are behind Review details.
- `fix-ownership-insurance-telematics-f04`: Retry failed: InsuranceTelematicsPage.test.tsx has 22 failures, including missing Recorded bounds/percentile metrics from direct summary-card-face queries; details are behind Review details.
- `fix-ownership-insurance-telematics-f07`: Retry failed: InsuranceTelematicsPage.test.tsx has 22 failures; locale/timezone date assertions read summary metadata that is no longer on the card face.
- `fix-ownership-insurance-telematics-f08`: Retry failed: InsuranceTelematicsPage.test.tsx has 22 failures; direct summary-card assertions cannot find values and source bounds in the collapsed brief.
- `fix-ownership-insurance-telematics-f09`: Retry failed: InsuranceTelematicsPage.test.tsx has 22 failures; direct summary-card assertions cannot find localized source details in the collapsed brief.
- `fix-ownership-insurance-telematics-f15`: Retry failed: InsuranceTelematicsPage.test.tsx has 22 failures; direct summary-card assertions cannot find source measure details in the collapsed brief.
- `fix-ownership-model-trust-mt05`: Retry failed: ModelTrustPage.test.tsx has 5 failures; locale/timezone and raw score details are queried from the collapsed summary face.
- `fix-ownership-tariff-lab-tl10`: Retry failed: TariffLabPage.test.tsx has 32 failures; assertions expect former summary content such as Not computed and Source returned on the card face.
- `fix-ownership-tariff-lab-tl08`: Retry failed: TariffLabPage.test.tsx has 32 failures; assertions expect former summary labels/status on the card face.
- `fix-ownership-tariff-lab-tl05`: Retry failed: TariffLabPage.test.tsx has 32 failures; retained source/publication metadata is queried from the collapsed summary face.
- `fix-ownership-tariff-lab-tl04`: Retry failed: TariffLabPage.test.tsx has 32 failures; assertions expect former summary content and status on the card face.
- `fix-ownership-tariff-lab-tl02`: Retry failed: TariffLabPage.test.tsx has 32 failures; summary currency/economics assertions query the collapsed card face.
- `fix-ownership-tariff-lab-tl01`: Retry failed: TariffLabPage.test.tsx has 32 failures; mobile-field assertions query former summary content without opening Review details.
- `fix-ownership-tariff-lab-tl09`: Retry failed: OwnershipBrief.test.tsx has 14 failures; direct brief assertions cannot find recorded bounds and quality details before opening Review details.
- `fix-ownership-tariff-lab-tl07`: Retry failed: OwnershipBrief.test.tsx has 14 failures; direct brief assertions cannot find date/freshness details before opening Review details.
- `fix-science-science-lab-sci-009`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-008`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-007`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-006`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-005`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-003`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-004`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-002`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-science-science-lab-sci-001`: Retry failed: ScienceLabPage.test.tsx has 41 failures; saved locale/date, source trust, and evidence details are queried directly from the collapsed Evidence at a glance brief. Representative output is only summary metrics until Review details is opened.
- `fix-settings-active-sessions-as-02`: Retry failed: SessionsSummaryCards.test.tsx has 2 failures: expected IP 10.2.2.2 and four data-operational-metric wrappers are absent from the current summary face.
- `fix-settings-helix-helix-08`: Retry failed: HelixStatusStrip.test.tsx has 12 failures; direct card-face assertions cannot find Provider, Source available, and related summary fields in current collapsed brief rendering.
- `fix-settings-privacy-privacy-01`: Retry failed: PrivacyPage.test.tsx has 9 failures, including persistence feedback/layout assertions; suite still expects former card-face metrics and status.
- `fix-sharing-share-card-sc09`: Retry failed: ShareCardPage.test.tsx has 1 failure; retained background-failure state expects visible Cached text in the collapsed brief.
- `fix-sharing-shared-drive-f05`: Retry failed: SharedDrivePage.test.tsx has 13 failures; exact speed text is duplicated and several SI/date/metric assertions expect former card-face values.
- `fix-sharing-shared-drive-f02`: Retry failed: SharedDrivePage.test.tsx has 13 failures; SI/date/metric assertions expect former card-face values and exact text is duplicated.
- `fix-sharing-shared-drive-f01`: Retry failed: SharedDrivePage.test.tsx has 13 failures; SI/date/metric assertions expect former card-face values and exact text is duplicated.
- `fix-system-search-ss02`: Retry verification failed 2026-10-15: `api/types.test.ts` passes and `go test -race ./internal/api/search` passes; `useSearch.test.tsx` passes. `SearchPage.test.tsx` remains 5/?? failed: its legacy summary/card assertions expect hidden fields in the collapsed OperationalBrief (3 results under Top match; Total results/Top match cards for empty or paused data; retained query/facet scope wording in collapsed summary). The current UI exposes those details in the Review details disclosure; coverage/missing-data assertions need migration to that contract.
- `fix-system-search-ss03`: Retry verification failed 2026-10-15: `api/types.test.ts` passes and `go test -race ./internal/api/search` passes; `useSearch.test.tsx` passes. `SearchPage.test.tsx` remains 5/?? failed: its legacy summary/card assertions expect hidden fields in the collapsed OperationalBrief (3 results under Top match; Total results/Top match cards for empty or paused data; retained query/facet scope wording in collapsed summary). The current UI exposes those details in the Review details disclosure; coverage/missing-data assertions need migration to that contract.
- `fix-system-search-ss10`: Retry verification failed 2026-10-15: `api/types.test.ts` passes and `go test -race ./internal/api/search` passes; `useSearch.test.tsx` passes. `SearchPage.test.tsx` remains 5/?? failed: its legacy summary/card assertions expect hidden fields in the collapsed OperationalBrief (3 results under Top match; Total results/Top match cards for empty or paused data; retained query/facet scope wording in collapsed summary). The current UI exposes those details in the Review details disclosure; coverage/missing-data assertions need migration to that contract.
- `fix-system-state-machine-debugger-f08`: Retry failed: state-machine focused suites have 23 failures; FSMOperationalBrief tests expect source bounds/freshness on the card face, while the shared brief now collapses details.
- `fix-system-tesla-api-usage-tu01`: Retry verification failed 2026-10-15: focused Tesla usage suite required 66 tests; TeslaApiUsageHistory.test.tsx failed 6 contract assertions and TeslaApiUsageCard.test.tsx failed 9. The failures are old direct card-face assertions for status/value/date/source details that are now inside the shared Review details brief; TeslaApiUsagePage and RangePicker test files passed. Exact failing tests: retained raw selected totals/category evidence; observed history/cycle/category values; successful zero totals; retained paused zero evidence/recovery; successful empty evidence/recovery; saved locale/timezone boundaries (2 modes); saved timezone mode changes; missing cycle date placeholders (invalid, empty, null, undefined); four billable categories/zero history; concise status/card link. See focused test output and final Vitest JSON in the OS temp directory.
- `fix-system-tesla-api-usage-tu02`: Retry verification failed 2026-10-15: focused Tesla usage suite required 66 tests; TeslaApiUsageHistory.test.tsx failed 6 contract assertions and TeslaApiUsageCard.test.tsx failed 9. The failures are old direct card-face assertions for status/value/date/source details that are now inside the shared Review details brief; TeslaApiUsagePage and RangePicker test files passed. Exact failing tests: retained raw selected totals/category evidence; observed history/cycle/category values; successful zero totals; retained paused zero evidence/recovery; successful empty evidence/recovery; saved locale/timezone boundaries (2 modes); saved timezone mode changes; missing cycle date placeholders (invalid, empty, null, undefined); four billable categories/zero history; concise status/card link. See focused test output and final Vitest JSON in the OS temp directory.
- `fix-system-tesla-api-usage-tu03`: Retry verification failed 2026-10-15: focused Tesla usage suite required 66 tests; TeslaApiUsageHistory.test.tsx failed 6 contract assertions and TeslaApiUsageCard.test.tsx failed 9. The failures are old direct card-face assertions for status/value/date/source details that are now inside the shared Review details brief; TeslaApiUsagePage and RangePicker test files passed. Exact failing tests: retained raw selected totals/category evidence; observed history/cycle/category values; successful zero totals; retained paused zero evidence/recovery; successful empty evidence/recovery; saved locale/timezone boundaries (2 modes); saved timezone mode changes; missing cycle date placeholders (invalid, empty, null, undefined); four billable categories/zero history; concise status/card link. See focused test output and final Vitest JSON in the OS temp directory.
- `fix-system-tesla-api-usage-tu07`: Retry verification failed 2026-10-15: focused Tesla usage suite required 66 tests; TeslaApiUsageHistory.test.tsx failed 6 contract assertions and TeslaApiUsageCard.test.tsx failed 9. The failures are old direct card-face assertions for status/value/date/source details that are now inside the shared Review details brief; TeslaApiUsagePage and RangePicker test files passed. Exact failing tests: retained raw selected totals/category evidence; observed history/cycle/category values; successful zero totals; retained paused zero evidence/recovery; successful empty evidence/recovery; saved locale/timezone boundaries (2 modes); saved timezone mode changes; missing cycle date placeholders (invalid, empty, null, undefined); four billable categories/zero history; concise status/card link. See focused test output and final Vitest JSON in the OS temp directory.
- `fix-system-tesla-api-usage-tu09`: Retry verification failed 2026-10-15: focused Tesla usage suite required 66 tests; TeslaApiUsageHistory.test.tsx failed 6 contract assertions and TeslaApiUsageCard.test.tsx failed 9. The failures are old direct card-face assertions for status/value/date/source details that are now inside the shared Review details brief; TeslaApiUsagePage and RangePicker test files passed. Exact failing tests: retained raw selected totals/category evidence; observed history/cycle/category values; successful zero totals; retained paused zero evidence/recovery; successful empty evidence/recovery; saved locale/timezone boundaries (2 modes); saved timezone mode changes; missing cycle date placeholders (invalid, empty, null, undefined); four billable categories/zero history; concise status/card link. See focused test output and final Vitest JSON in the OS temp directory.
- `fix-system-tesla-api-usage-tu05`: Retry verification failed 2026-10-15: focused Tesla usage suite required 66 tests; TeslaApiUsageHistory.test.tsx failed 6 contract assertions and TeslaApiUsageCard.test.tsx failed 9. The failures are old direct card-face assertions for status/value/date/source details that are now inside the shared Review details brief; TeslaApiUsagePage and RangePicker test files passed. Exact failing tests: retained raw selected totals/category evidence; observed history/cycle/category values; successful zero totals; retained paused zero evidence/recovery; successful empty evidence/recovery; saved locale/timezone boundaries (2 modes); saved timezone mode changes; missing cycle date placeholders (invalid, empty, null, undefined); four billable categories/zero history; concise status/card link. See focused test output and final Vitest JSON in the OS temp directory.
- `fix-telemetry-signal-correlation-sc-04`: Retry failed: CorrelationStatStrip.test.tsx has 21 failures; detail metrics and labels are asserted directly on the collapsed brief face.
- `fix-ownership-shared-quality-labels`: Retry failed: OwnershipBrief.test.tsx has 14 failures; quality/status detail assertions such as Future failures are hidden until Review details is opened.

#### Locale, formatting or copy assertions (16)

- `fix-charging-charging-heatmap-chh006`: Retry verification failed 2026-10-15: focused charging set 341 passed / 44 failed. ChargingHeatmap page tests fail 10 KPI assertions: expected data-operational-metric/value cards (including Avg Duration) while the current informational brief omits card wrappers for unavailable metrics; example TypeError is `.toHaveAttribute` received null.
- `fix-dashcam-dashcam-intelligence-dc016`: Retry failed: EventEvidencePanel.test.tsx has 1 localization regression; saved descriptor text with quotes/ampersand is not found after language change. RedactionEditor and eventDetection suites pass.
- `fix-diagnostics-remaining-useful-life-rul-04`: Retry failed: RemainingUsefulLifePage.test.tsx has 15 failures; localized battery labels are missing from expected Health forecast headings and source-status assertions.
- `fix-diagnostics-remaining-useful-life-rul-05`: Retry failed: RemainingUsefulLifePage.test.tsx has 15 failures; localized battery labels and independent source details fail page assertions.
- `fix-diagnostics-root-cause-intelligence-rc01`: Retry failed: RootCauseIntelligencePage.test.tsx has 12 failures; paused-state test cannot find its expected data-state marker and effect values are not in the expected display format.
- `fix-fleet-ops-fleet-operations-f03`: Retry failed: helpers.test.ts has 1 failure; view-model timezone expected Asia/Tokyo but received America/Los_Angeles.
- `fix-fleet-ops-fleet-operations-f05`: Retry failed: helpers.test.ts has 1 failure; view-model timezone expected Asia/Tokyo but received America/Los_Angeles.
- `fix-home-energy-whole-home-energy-f07`: Retry failed: EnergyFlowChart.test.tsx has 7 failures; accessible tooltip/table units and percent/power formatter outputs differ from expected values.
- `fix-notifications-archived-f12`: Retry failed: InboxBody.test.tsx has 8 failures; an exact metric format mismatch (expected 1,250 ms, rendered 1,250.00 ms) and archived details/dialog assertions fail.
- `fix-notifications-channels-nc002`: Retry failed: ChannelProvidersPanel.test.tsx cannot find translated provider label Courriel; 1 failure.
- `fix-system-my-activity-ma-03`: Retry verification failed 2026-10-15: MyActivityPage.test.tsx cannot resolve its legacy KPI-card assertions for unavailable initial data; expected “Total actions” data-metric cards are replaced by one informational no-metrics state. The full test also had missing Last active text in the empty activity case.
- `fix-system-system-status-ss-001`: Retry failed: SystemStatusPage.test.tsx has one failure; recovery still renders the informational empty state, contrary to the test expectation that no status region remains.
- `fix-system-system-status-ss-002`: Retry failed: SystemStatusPage.test.tsx has one failure; recovery still renders the informational empty state, contrary to the test expectation that no status region remains.
- `fix-system-system-status-ss-003`: Retry failed: SystemStatusPage.test.tsx has one failure; recovery still renders the informational empty state, contrary to the test expectation that no status region remains.
- `fix-system-system-status-ss-010`: Retry failed: SystemStatusPage.test.tsx has one failure; recovery still renders the informational empty state, contrary to the test expectation that no status region remains.
- `fix-system-system-status-ss-019`: Retry failed: SystemStatusPage.test.tsx has one failure; recovery still renders the informational empty state, contrary to the test expectation that no status region remains.

#### Fixture or chart contract mismatch (9)

- `fix-diagnostics-root-cause-intelligence-rc08`: Retry failed: ServiceEvidencePackPage.test.tsx has 9 failures; graph swatch lookup returns undefined and expected Last updated metadata is absent from the summary face.
- `fix-diagnostics-service-evidence-pack-sep-source-007`: Retry failed: ServiceEvidencePackPage.test.tsx has 9 failures; graph swatch lookup returns undefined and snapshot timestamp is not visible on the summary face.
- `fix-intelligence-packs-intelligence-pack-marketplace-f04`: Retry failed: SandboxPreviewPanel.test.tsx has 7 failures, all charts throw Recharts “Could not find Recharts context” from the test render.
- `fix-intelligence-packs-intelligence-pack-marketplace-f13`: Retry failed: SandboxPreviewPanel.test.tsx has 7 failures, all charts throw Recharts “Could not find Recharts context” from the test render.
- `fix-intelligence-packs-intelligence-pack-marketplace-f14`: Retry failed: SandboxPreviewPanel.test.tsx has 7 failures, all charts throw Recharts “Could not find Recharts context” from the test render.
- `fix-notifications-notification-health-nh-12`: Retry failed: NotificationLatencyPanel.test.tsx has 25 failures; expected notification-chart-data is absent and empty Apdex neutrality queries return null.
- `fix-notifications-notification-health-nh-13`: Retry failed: NotificationLatencyPanel.test.tsx has 25 failures; expected notification-chart-data is absent and empty Apdex neutrality queries return null.
- `fix-notifications-notification-health-nh-14`: Retry failed: NotificationLatencyPanel.test.tsx has 25 failures; expected notification-chart-data is absent and empty Apdex neutrality queries return null.
- `fix-notifications-notification-health-nh-15`: Retry failed: NotificationLatencyPanel.test.tsx has 25 failures; expected notification-chart-data is absent and empty Apdex neutrality queries return null.

#### Ambiguous text or role queries (7)

- `fix-ownership-model-trust-mt04`: Retry failed: ModelTrustPage.test.tsx has 5 failures; draft preservation/entry tests cannot find summary detail values and use duplicate Close button queries.
- `fix-settings-active-sessions-as-04`: Retry failed: ActiveSessionsPage.test.tsx has 2 failures because exact IP text 10.0.0.2 appears more than once; the getByText query is ambiguous.
- `fix-settings-active-sessions-as-03`: Retry failed: ActiveSessionsPage.test.tsx has 2 failures because exact IP text 10.0.0.2 appears more than once; the getByText query is ambiguous.
- `fix-system-system-status-ss-011`: Retry failed: StatusHero.test.tsx has 5 failures; healthy state has no expected shadow marker, and degraded/unhealthy queries find multiple status roles.
- `fix-watch-watch-face-f01`: Retry failed: WatchFacePage.test.tsx has 2 failures because expected “Cached vehicle data” and “Historical vehicle data” text is duplicated between visible content and tooltip accessible text; getByText is ambiguous.
- `fix-watch-watch-face-f06`: Retry failed: WatchFacePage.test.tsx has 2 failures because expected “Cached vehicle data” and “Historical vehicle data” text is duplicated between visible content and tooltip accessible text; getByText is ambiguous.
- `fix-watch-watch-face-f10`: Retry failed: WatchFacePage.test.tsx has 2 failures because expected “Cached vehicle data” and “Historical vehicle data” text is duplicated between visible content and tooltip accessible text; getByText is ambiguous.

#### Domain or UI assertions requiring diagnosis (4)

- `fix-charging-charging-curve-f08`: CHECKPOINT 2026-10-15: charging-curve helper + page selector suites passed (2 files, 91 tests); broader curve cluster remains open.
- `fix-charging-charging-curve-f05`: CHECKPOINT 2026-10-15: charging-curve helper + page selector suites passed (2 files, 91 tests); broader curve cluster remains open.
- `fix-charging-charging-curve-f04`: CHECKPOINT 2026-10-15: charging-curve helper + page selector suites passed (2 files, 91 tests); broader curve cluster remains open.
- `fix-charging-powershare-ps-f05`: CHECKPOINT 2026-10-15: Powershare helpers/constants/runtime/stop-reason suites pass (85 tests); trend card remains open.

