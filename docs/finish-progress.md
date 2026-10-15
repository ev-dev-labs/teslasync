# Frontend finish progress (Phase 6 → Phase 7)

Resume file for whoever continues this work. Updated and pushed after every group.

## Where things are

- Branches: work is committed on `fix/dashboard-followups-finish` and pushed to
  **both** `origin/fix/dashboard-followups-finish` and `origin/fix/dashboard-followups`
  after every group (fast-forward only). The original session worked in the
  worktree `.claude/worktrees/phase6-finish` with `web/node_modules` as a junction
  to the main checkout's `web/node_modules` (no package changes).
- Item status: the main checkout's `.runner/state.json` (gitignored). Closed items
  get `Status: "done"` (or `"excluded"`), `Commit`, and a `FINISH: …` note appended.
  As of the last update: 646 done, 500 pending, 130 failed (68 closed in this
  finishing pass so far).
- Baselines used for "is this failure new?": full Vitest at HEAD before this pass
  had **4,279 failing tests**; after the shared harness repair **~1,830**.

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
