# Frontend finish progress (Phase 6 → Phase 7)

Resume file for whoever continues this work. Updated and pushed after every group.

## Current priority order (2026-10-15 handoff)

1. Pass build, `npx tsc --noEmit`, lint, and split-i18n catalog check; defer the full Vitest suite.
2. Follow `docs/ui-simplification-task.md` from section 0 on `ui/simplification`, branched from `fix/dashboard-followups`.
3. After simplification, run the full Vitest suite and repair failures.
4. Complete every Phase 6 pending item and retry every failed item once using its notes. Exclude only exact changes replaced by simplification commits, with the replacement and commit recorded. Update `.runner/state.json` and this file after each group, then list all excluded and failed items with specific reasons.

The web gates are build, `npx tsc --noEmit`, lint, and `node scripts/split-i18n-catalog.mjs --check`. Every new user-facing string must use `t()` and a complete-sentence `en.json` key; plurals use i18next `count`.

## Current UI simplification checkpoint

Working on `ui/simplification`. Rows 0–3 are complete and pushed. Row 4 (vehicles) is in progress. Initial gates now pass after regenerating the stale usage manifest: catalog check, full lint, standalone typecheck, and production build. The build retains its existing CSS parser and startup bundle warnings. Focused vehicle work remains in progress; full Vitest is deferred until the UI simplification is complete.
## Where things are

- Active branch: `ui/simplification`, based on `fix/dashboard-followups`.
- Current UI checkpoint: rows 0–3 complete; vehicles row 4 is in progress. Rows 5–7 remain.
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
