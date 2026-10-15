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

Real product bugs fixed along the way: drive-detail energy/regen estimate was
1000× too large; (0,0) GPS placeholder stretched routes; TorqueHistory ticks
lost scalable typography; thermal bands conveyed only by colour; missing CSV
export on origin concentration; stale "kW ×1000" methodology copy; efficiency
scorecard JSON/CSV dropped the target gap; inline ErrorBoundary rendered blank
labels without i18n init and was not announced (now role=alert).

### Next up (driving, then other features)

rhythm (f01/f03, punchcard
f04, tips f03/04/05/07) → compare (f01/f07, driveCompare f05) → what-if
(003/006/007) → misc (ShareDriveDialog f03, ElapsedComposition 02, replayMarkers
f10). Then vehicles (62), vehicle-systems (45), charging (48), system (47),
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
