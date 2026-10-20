# UI simplification plan

Source of truth: `docs/ui-simplification-task.md`, starting at section 0. Branch: `ui/simplification`, created from `fix/dashboard-followups` at `7570c940ec`.

## Explore inventory

- Evidence card: `web/src/components/data-display/OperationalBrief.tsx`; current props include eyebrow, descriptive sentence, status badge, scope, freshness, actions, provenance, metrics, and narrative. Drawer is `OperationalNarrativeDetails.tsx`; tests include `OperationalBrief.test.tsx` and many feature/page suites that query its `Review details` role.
- Widget shell: `web/src/features/dashboard/widgets/WidgetShell.tsx` already centralizes a `DataFreshness` / `DataFreshnessAuto` header slot, refresh callback, loading/error states, help, pin and actions. Freshness implementation is under `web/src/components/data-display/DataFreshness*`; inspect before changing. The requested shared freshness dot will need to replace the existing chip consistently.
- Shared primitives: `web/src/components/ui/Button.tsx`, `Tooltip.tsx`, `Card.tsx`, `GlassPanel.tsx`, `Drawer.tsx`; icons are from `web/src/lib/icons.ts`. Reuse these and their established tooltip / keyboard conventions.
- Dashboard widgets are under `web/src/features/dashboard/widgets/`; feature pages and cards are under `web/src/features/*`. Initial recursive searches found OperationalBrief usage in vehicle pages, dashboard widgets, and other feature evidence views. The broad `Refresh` icon scan found 40+ candidates, so migrations will be inventory-driven and sequenced by shared component, dashboard, then high-traffic feature surfaces.
- Copy catalog is `web/src/i18n/en.json`, with generated split locale bundles. New UI strings will use `t()` and complete sentence keys; plural forms will use `count`. Run 
ode scripts/split-i18n-catalog.mjs --check` after catalog edits.
- Package commands: 
pm run build`, 
pm run lint`, 
px tsc --noEmit`, 
px vitest run`, and 
pm run e2e` (Playwright wrapper). No browser/dev-server interaction is attempted until the in-app/browser tooling and existing server are verified.

## Baseline gates

On `fix/dashboard-followups`, before UI edits: split catalog check passed (57 bundles, 181 fallbacks, 1,264 inlined keys, 0 missing); 
pm run lint` passed; 
px tsc --noEmit` passed; 
pm run build` passed (one existing CSS parse warning and a non-failing startup-JS budget warning, 404.8 KB vs 400 KB). Per the user's revised order, defer the full Vitest suite until simplification is complete. No e2e baseline was run.

## Checklist

| # | file / surface | page/route | widget/card | A | B | C | D | data-layer gap | attempts | status |
|---|---|---|---|---|---|---|---|---|---:|---|
| 0 | `OperationalBrief.tsx`, `OperationalNarrativeDetails.tsx`, shared tests | shared | Evidence card | done | done | n/a | done | shared dashboard brief callers use embedded mode | 2 | done |
| 1 | `components/ui/IconButton.tsx`, shared tooltip, button | shared | IconButton | n/a | done | n/a | n/a | none | 1 | done |
| 2 | shared widget header and freshness primitives | dashboard | WidgetShell | n/a | done | done | n/a | known polling cadences supplied by eight polling widgets; other shell data is manual | 2 | done |
| 3 | `features/dashboard/widgets/**` | dashboard | all dashboard widgets | done | done | done | done | Quick Nav is static; shared header retouch and embedded overview brief verified | 2 | done |
| 4 | `features/vehicles/**` | vehicle routes | evidence cards and repeated actions | done | done | done | done | per row | 2 | done |
| 5 | `features/charging/**` | charging routes | evidence cards and nested panels | done | done | done | done | per row | 2 | done |
| 6 | remaining `features/*/**` | all remaining routes | evidence cards, repeated actions, nested cards | done | done | done | done | per row | 2 | done |
| 7 | grep exit check, full gates and browser/e2e | app-wide | leftovers / summary | verify | verify | verify | verify | confirm | 1 | done |
| 8 | `components/layout/StatusBar.tsx`, `status-bar/*Segment.tsx`, `index.css` shell bar geometry | app shell | bottom status bar (API / Live / Guessed / Now / Recent / More / Helix) | n/a | done | done | done | none | 2 | done |
| **9** | **Drive detail page restructure** | `/drives/:id` and same-pattern pages | row group | | | | | | | done |
| 9a | chart cards with detached summary tables/captions (grep: summary rendered as sibling of a chart card) | drive detail, then all matches | chart summary rows inside their card, self-explanatory labels with units | done | done | done | done | UI only; values and calculations unchanged | 1 | done |
| 9b | drive detail Overview tab | `/drives/:id` Overview | map + journey info panel hero (trip replay model), one stat grid, one heading per section | done | done | done | done | UI only; start/end pins with dashed line when the route path is not recorded | 1 | done |
| 10 | `ThemeProvider.tsx`, `ThemePicker.tsx`, `Toggle.tsx`, `TabNav.tsx`, `index.css` accent tokens | app-wide | exact selected accent (preset or custom) | n/a | done | n/a | done | none; contrast only via on-accent text colour | 1 | done |
| 11 | app-wide sweep: old freshness indicator and text-labelled repeated actions (`scripts/audit-freshness-actions.mjs`) | all routes: page headers, toolbars, widgets, tables, drawers, menus | FreshnessDot; icon-only ghost IconButton | n/a | done | done | done | none; flow CTAs and event-time "just now" documented in code | 1 | done |
| 12 | `PageActions.tsx`, `PageContainer.tsx`, `PageHeader.tsx` | every page header | one non-splitting dot + icon cluster | n/a | done | n/a | n/a | none | 1 | done |
| 13 | app-wide sweep, extended vocabulary: Undo, Redo, Auto arrange, Reset, Columns, Density, Share, Print, Copy, Expand/Collapse, Edit, Delete/Remove/Clear | page headers, edit modes, toolbars, tables, widgets, drawers, dialogs, menus | icon-only ghost IconButton; destructive ones confirm | n/a | done | done | done | none | 2 | done |
| 14 | Map overview page (`/live`) restructure on the trip-replay model | `/live` | map + info panel hero in one surface | done | done | done | done | none; UI only | 1 | done |
| 15 | Trip replay page layout fixes (map height, sources drawer, timestamps, style switcher) | trip replay route | replay hero | done | done | done | done | none; UI only; negative Age logged report-only | 1 | done |
| 16 | Dashboard widget shell: horizontal overflow, padding tokens, container-query resize, vertical scroll, Playwright guard | all dashboard widgets | WidgetShell + panel | done | done | done | done | none; UI only; per-widget guard records below | 1 | done |
| 17 | Layout-collapse regression: attribute + shared grid/panel/break/chart fixes + route guard (277 routes × 4 widths) + route gallery | app-wide | Grid / LayoutCard / pages | done | n/a | n/a | done | none; UI only; cause: LayoutCard `@container` (pre-existing, `3ca496945b`) inside `max-content` tracks — NOT row 16 (A/B identical); closeout receipt below (no per-route table: first-run artifacts lost to output-dir cleanup; gallery deferred to row 7) | 1 | done |
| 18 | Open request 5 (real regressions): services-retry wiring, integer-ms titles, formatter test reset | system status + shared format | services empty Retry; ms titles; formatter prefs | n/a | done | done | done | none; UI only; receipt below | 1 | done |
| 19 | `/live` one-map two-mode merge: remove separate Recent route playback section; Live \| Recent route segmented switch in the map header; panel follows mode (playback stats in Recent mode, Location details in Live); reuse trip-replay components; fit-route/recenter on switch; empty state when no route; keyboard + tooltips; map fills row height (mobile: map, bar, panel); style-switcher fix in the SHARED map component | `/live` | map + panel hero, playback bar | done | done | done | done | none; UI only; receipt below | 1 | done |

Row 19 receipt (2026-10-17): hero owns a Live | Recent route TabNav (URL `?mode=`, default Live). Recent mode renders shared RoutePlayback with a new `bare` prop (no outer GlassPanel, map flex-fills, controls below) + panel stats via shared PlaybackControls cursor and reused TripReplayReadout (time/speed/battery/power; range+temperature unavailable in position records → omitted, no new queries). Mode switches remount (fit-route on Recent entry, recenter on Live return). No-route Recent shows map-cell + panel empty states with no bar; history error shows map-cell retry + panel note. Freshness dot stays Live-only (it describes the live query); Details drawer shared. Style-switcher root cause: `L.TileLayer` ignores `className`, so the row-15 invert filter never applied (Dark selected, light tiles) — fixed in shared MapTileLayer by toggling `map-style-dark` on the map container (index.css rule wins ties), verified Dark→invert/Streets→no-invert in Edge. Suites: MapTileLayer 12/12 (2 new), RoutePlayback 17/17 (3 new bare), MapOverviewPage 40/40 (9 migrated + 3 new). Screenshots row19-{live,recent}-{1280,768,375}.png. Gates: tsc, eslint, catalog check, build green.

Exit-check inventory (run from `web/`):

```sh
rg -n '<(OperationalBrief|DashboardSourceBrief|ChargingSummaryBrief|VehicleEvidenceBrief|DrivingSummaryBrief|FleetSectionBrief|SystemSummaryBrief|BatteryEvidenceBrief|VehicleOperationalBrief|TripOperationalBrief|SettingsSummaryBrief)' src
rg -n '<(GlassPanel|LayoutCard|Card|Panel|Section|WidgetShell)|data-operational-brief-surface=' src
rg -n 'maxPerRow|data-max-per-row|data-operational-metric-bank|data-columns=' src
```

Trace each result through composed parents and verify no block has more than one bordered/raised surface. Every nested brief must use `variant="embedded"` (including wrapper forwarding) or the outer surface must be removed. Review similar evidence-card wrappers beyond this named list as part of the `*Brief` usage inventory. Validate every metric grid's `maxPerRow` cap and balanced rows; six-tile groups render 3 + 3 and short rows have no orphan tile.

## Progress checkpoints

- Rows 5/6 remainder assessed (2026-10-17). Mechanical criteria are at zero app-wide: nested-surfaces audit 0/0/0, freshness-actions audit OK (both exit 0). The remainder is the per-brief disclosure migration, whose vehicle is the test-repair queue: 1,211 actionable fails left (excl. deferred i18n trio). Rows 5/6 stay in progress and close via wave 3 (16 folders) + main-agent shared/small remainder (src/*, watch, vehicle-systems, documented pre-existing blocks); row 7 exit follows the last green suite.
- Wave 3 Stage 3 at 15/16 (2026-10-17): 520 child-resolved + 14 main-agent migrations integrated and pushed; 52 proven pre-existing + 18 trio-class i18n documented as out-of-scope. Analytics (201) still in progress with its child; dashboard 86 / charging 122 / admin 175 partials remain for a wave-4 mop-up before the row 7 exit.
- Wave 3 closed 16/16 + post-wave-3 suite 55975/982 (2026-10-17): reconciled exact; MapTileLayer row-19 fallout fixed (21/21 + resolved-tiles marker); ChargingForensics 1 proven flake. Trio + trio-class (507) owned by branch ui/i18n-trio, never touched here. Wave 4 spawned on the 4 partials (admin 175, charging 122, dashboard 86, analytics 9); rows 5/6 + row 7 exit follow.
- Wave 4 closed 4/4 + reboot resume (2026-10-17/18): analytics 9, dashboard 86, charging 122, admin 175 = 392 resolved, cumulative 3394; machine rebooted mid-wave-4, all WIP survived, 3 resume children finished the remainder; all folders verified green on the main tree (4572/4572, 2064/2064, 3338/3338) with 4 production hunks each pinned by pre-existing unweakened tests; worktrees/branches removed.
- Rows 5/6 closed (2026-10-17): mechanical audits zero app-wide (nested 0/0/0, freshness OK); post-wave-4 suite 56374/583 with fixed-titles diff exactly 400 (392 wave-4 + 8 MapTileLayer) and 0 regressions — remaining are trio 507 + pre-existing 52 + stable blocks 22 + 2 proven flakes; gates green (tsc, eslint + 40 audits, production build; exit-check fixes: 9 unused test imports, 2 sr-only audit allowlist entries for test-only detection, i18n usage-manifest regen +3 keys).
- Row 7 exit check pass 1 in progress (2026-10-17): 7/7 leftover greps clean; freshness age labels confirmed on the one shared singleton ticker (pre-existing 60s page tick + per-instance stale-hook timers logged as out-of-scope); route guard sweep + gallery on the final tree pending.
- Row 7 complete (2026-10-17): guard sweep 277/277 routes x 4 widths, 0 violations (1108 records, 12/12 Playwright tests green on Edge, run `row7-final`); route gallery re-curated from the final tree (554 JPEGs); committed gallery error-boundary states (e.g. /charging `home_charging_pct`) verified byte-identical in kind to the row-17 gallery — a mock-data artifact, pre-existing, not a regression. All checklist rows done, none blocked. Handoff in Summary.
- Trio merge + wave 5 (2026-10-18): `ui/i18n-trio` merged with 0 conflicts (trio 7,672/0 verified on the merged tree; LF + checkpoint follow-ups); post-merge suite F 56,766/191 drove wave 5 (111 trio-copy interactions, 4/4 integrated, folders verified); final suite G **56,877/80** with fixed-titles diff exactly 111 and 0 new — remaining are trio-class 6 + pre-existing 52 + blocks 22. Row 7 totals updated to the G suite.
- Workflow Stage 2 wave 2 complete (16 folders, 2026-10-17). 16 subagents, manual worktrees + junctions, `--maxWorkers=2`, 4 staggered batches. All integrated one-by-one with verification + push: driving 219, battery 171, telemetry 146, vehicles 222, notifications 134, advintel 111, settings 103, ownership 88, system 76, diagnostics 37, home-energy 32, automations 29, resale-vault 26, fleet-ops 24, svc-intel 23, trips 23 = 1,464 resolved (13 folders 100% green; system/diagnostics partial by timebox; battery-ChargeAdvisor 14 + driving-TripReplay 3 + telemetry 5 documented pre-existing blocks). 5 UI-only prod fixes (touch sizing, testId, n-interp, focus restore, -0 norm) + 1 comment-only. Shared/catalog follow-ups deferred with rationale. Cumulative resolved 2,276. Post-integration full suite follows.
- Workflow Stage 2+3 complete (parallel folder repairs, 2026-10-17). Runtime worktree isolation unavailable → 4 subagents on manual sibling worktrees (node_modules junctions, 45-min timeboxes). Delivered: admin 66 (5 files), dashboard 114 (15 files), charging 41 (2 files), analytics 23 (1 file) = 244 resolved, all test-only, all cherry-picked one-by-one with per-pick suite verification (116/116, 488/488, 122/122, 54/54) + push. Shared requests deferred with rationale (global useSettings-mock change risks green suites; invalid-gap already report-only). Cumulative resolved 812. Full-suite re-run follows.
- Workflow Stage 1 complete (bulk-pattern assessment, 2026-10-17). Scoped all 572 failing files from the full-suite report for script-safe codemods: icon-only text queries 3 hits (2 are heatmap legend labels, not buttons), `.closest('button')` 7 hits (all `toBeNull` non-button asserts or Explore suggestion lookups), em-dash queries 333 hits in 163 files (per-case KPI counts / truthfulness guards), missing-tile pins 136 hits in 75 files (per-brief counts), old-freshness text 15 hits in 9 files (relative-time content). Dominant signature `not-found` (1,323) = drawer migrations needing per-page knowledge. Verdict: no safe global codemod; repair continues per-folder in Stage 2. One genuine mechanical straggler fixed: `ClimateModernization.test.tsx` `getByText('Refresh')` → `getByRole('button', { name: 'Refresh' })` (suite 14/1 → 15/15). Cumulative resolved 568. Gates: tsc, touched-file lint (build/catalog unaffected, test-only).
- Row 18 complete (open request 5: real regressions). (a) System Status services empty state stayed after recovery: its Retry refetched the extended query while the section reads `health.components` — and both hooks hit `/system/health` under independent cache keys, so after an outage the retry recovered the wrong entry and the empty stayed. Retry now calls `refetchHealth()`. Also passed `busy={isFetching}` to the Refresh IconButton (aria-busy while fetching; that test goes green unchanged). Page-level error/empty→recovery transitions were proven to clear via a live Edge fail→recover probe and a jsdom rerender probe. (b) 1,250 ms rendered as 1,250.00 ms: the number-format refactor (`2d2c0979f2`) switched Duration's hover title from raw `${ms} ms` and SourceLayerBadge's sub-second age from `Math.round` ms to settings-precision `fmtWithUnit`. Both `ms` sites now pass decimals=0 (locale grouping kept); s/min/h/d untouched. (c) French locale leaked between tests: `setGlobalLocale`/`setGlobalPrecision` mutate module state with no reset path, so any French-locale or precision-4 case bled into later tests. Added `_resetFormatterPreferences()` plus a global `beforeEach` reset (auth-latch precedent; setup hooks run before file hooks so pinned values still win). Tests: new retry-wiring test (fails 0-calls before, passes after) + empty-clears-on-recovery guard; Duration title assertions made literal (`0 ms`, `1,500 ms`, de-DE `1.500 ms`); badge tolerance regex tightened to integer ms; numberFormat +1 reset test (59/59); French-setting suites (EvidencePanel.sampleCounts, FormatterPrefsBridge, RecommendationCard) green with the global reset. Suites: SystemStatusPage 123/124 (1 button-`title` drift queued for repair), Duration 29/30 (1 `formatDurationMsLong(0)` HEAD failure, stash-proven pre-existing, queued), SourceLayerBadge green. Gates: tsc, touched-file lint, audit, catalog, production build.
- Row 17 complete (layout-collapse regression). Attribution: LayoutCard's `@container` (pre-existing since `3ca496945b`) contributes ~0 intrinsic width inside bare `max-content` grid tracks — the 26px collapse signature reproduces identically with the row-16 changes reverted, so NOT row 16. Shared fixes (all in layout/grid components or narrow page rules): DriveCalendar track floored to `minmax(min(100%,15rem),max-content)`; CardGrid column spans moved onto item wrappers via `colSpanClass()`; LayoutCard title floored `min-w-[min(100%,12rem)]`; new `MetricGrid` (auto-fit, 200px floor) migrated for cycle-stress ×5, pack-capacity ×4, hero stats, quick links/nav, drive-score; climate seats `@3xl`→`@6xl` (5×200px rule); status list rows wrap + floor; UsageCard `break-all`→`break-words` (prose only). Guard `web/e2e/route-layout-guard.smoke.spec.ts`: 277 routes × 375/768/1280/1920, fails on any <200px card/panel at ≥768px, per-character wrap (Range-API line boxes, own-text only, `.sr-only`/`svg`/`.leaflet-container` excluded), or horizontal overflow; asserts an empty violations list. Full guard sweep 277/277, 0 violations (first run); artifacts lost to Playwright's output-dir cleanup; route gallery deferred to the row 7 exit check. Gallery delivered 2026-10-17: re-sweep 277/277 x 4 widths, 0 violations (1108 records; chunk 1/2 needed one quiet re-run each after HMR-interference load errors); 554 JPEGs (1280+375 per route) curated in `docs/ui-simplification/route-gallery/`. `/pack-capacity` + `/dev/stats` re-verified green on the final tree (8/8, then 4/4 each after the artifact-dir fix). Fix for next time: the guard now writes records + JPEGs to run-stamped `web/test-results-guard/<runId>/` outside Playwright's outputDir (`GUARD_RUN_ID` pins the directory), gitignored; verified live with two consecutive runs whose artifact dirs both survive. Gates: tsc, touched-file lint, audit, production build.
- Row 16 complete (dashboard widget shell). Body token owns the scroll boundary: `overflow-x-clip overflow-y-auto break-words [&>*]:min-w-0` (+ `data-testid="widget-body"`); header/actions-row use one `pr-4` inset (dead `--dashboard-widget-chrome-inset` var removed); grid panel `overflow-y-auto` → `overflow-clip` (the old value forced x-auto: phantom horizontal scrollbars); FleetPosture drops `noPadding` + own `px-4` wrapper for shell padding; Sparkline gains `viewBox` + `h-auto max-w-full` so charts shrink instead of overflowing. Guard-found root causes, both fixed once in shared components: (1) opacity-0 Tooltip bubbles sticking past bodies inflated scrollWidth by exactly 15px (the blank-space scrollbar) — Tooltip now clamps its bubble inside clipping ancestors and observes them for post-mount shrinks (fsd-weekly scrollbar-appears-after-mount case); (2) TimelineItem `-mx-1` row bleed (+4px) — WidgetEventFeed root gains `overflow-x-clip`. Pre-existing shell-suite freshness failures repaired: the documented-but-unimplemented `compact` prop now exists on FreshnessDot/FreshnessDotAuto (20px/8px dot) and the shell passes `compact={!title}`. Guard `e2e/dashboard-widget-overflow.smoke.spec.ts`: 121 registry widgets × min/default/large × view/edit, worst-of-3-samples per config, text = own direct text only, `.sr-only`/`svg`/`.leaflet-container` subtrees excluded (all visually verified), no `assertMockApiComplete` (documented: error states are valid geometry subjects). Tests: WidgetShell 31/31 (2 padding + 3 freshness repaired), Sparkline 17/17 (+1 fluid), Tooltip 29/29 (+1 clipping-ancestor), WidgetEventFeed 22/22, FleetPostureWidget 10/10. Edge + dev server: 121/121 on all 6 configs, twice green; screenshots `row16-{fleet-posture,battery-gauge,location-map,vehicle-hero,vehicle-twin,recent-drives}-{min,large}.png`. Gates: tsc, touched-file lint, audit 0, production build. Per-widget records follow.
Row 16 guard records (121 widgets × min/default/large × view/edit; Edge, dev server, worst of 3 samples per config):

| widget | min view | min edit | default view | default edit | large view | large edit |
|---|---|---|---|---|---|---|
| alert-feed | pass | pass | pass | pass | pass | pass |
| analytics-summary | pass | pass | pass | pass | pass | pass |
| anomaly-detector | pass | pass | pass | pass | pass | pass |
| api-usage | pass | pass | pass | pass | pass | pass |
| audit-log | pass | pass | pass | pass | pass | pass |
| automation-history | pass | pass | pass | pass | pass | pass |
| automation-status | pass | pass | pass | pass | pass | pass |
| backup-history | pass | pass | pass | pass | pass | pass |
| backup-monitor | pass | pass | pass | pass | pass | pass |
| battery-cells | pass | pass | pass | pass | pass | pass |
| battery-degradation-forecast | pass | pass | pass | pass | pass | pass |
| battery-degradation-trend | pass | pass | pass | pass | pass | pass |
| battery-gauge | pass | pass | pass | pass | pass | pass |
| battery-health-analytics | pass | pass | pass | pass | pass | pass |
| battery-radial-gauge | pass | pass | pass | pass | pass | pass |
| charge-cost-tracker | pass | pass | pass | pass | pass | pass |
| charge-history | pass | pass | pass | pass | pass | pass |
| charge-plans | pass | pass | pass | pass | pass | pass |
| charge-session-chart | pass | pass | pass | pass | pass | pass |
| charge-status | pass | pass | pass | pass | pass | pass |
| charge-status-live | pass | pass | pass | pass | pass | pass |
| charging-optimizer | pass | pass | pass | pass | pass | pass |
| charging-schedule | pass | pass | pass | pass | pass | pass |
| charging-session-detail | pass | pass | pass | pass | pass | pass |
| charging-telemetry | pass | pass | pass | pass | pass | pass |
| climate-control-panel | pass | pass | pass | pass | pass | pass |
| climate-history | pass | pass | pass | pass | pass | pass |
| climate-status | pass | pass | pass | pass | pass | pass |
| command-history | pass | pass | pass | pass | pass | pass |
| command-quick-actions | pass | pass | pass | pass | pass | pass |
| cost-breakdown | pass | pass | pass | pass | pass | pass |
| cost-forecast | pass | pass | pass | pass | pass | pass |
| dashboard-stats | pass | pass | pass | pass | pass | pass |
| destination-eta | pass | pass | pass | pass | pass | pass |
| digital-twin-mini | pass | pass | pass | pass | pass | pass |
| door-window-status | pass | pass | pass | pass | pass | pass |
| drive-efficiency-chart | pass | pass | pass | pass | pass | pass |
| drive-score | pass | pass | pass | pass | pass | pass |
| drive-score-gauge | pass | pass | pass | pass | pass | pass |
| drive-telemetry | pass | pass | pass | pass | pass | pass |
| drivetrain-health | pass | pass | pass | pass | pass | pass |
| driving-coach | pass | pass | pass | pass | pass | pass |
| driving-dynamics | pass | pass | pass | pass | pass | pass |
| energy-flow | pass | pass | pass | pass | pass | pass |
| energy-flow-animated | pass | pass | pass | pass | pass | pass |
| energy-site-info | pass | pass | pass | pass | pass | pass |
| energy-stats | pass | pass | pass | pass | pass | pass |
| export-status | pass | pass | pass | pass | pass | pass |
| fleet-posture | pass | pass | pass | pass | pass | pass |
| fleet-stats | pass | pass | pass | pass | pass | pass |
| fleet-stats-bar | pass | pass | pass | pass | pass | pass |
| fsd-weekly | pass | pass | pass | pass | pass | pass |
| fsm-distribution | pass | pass | pass | pass | pass | pass |
| geofence-status | pass | pass | pass | pass | pass | pass |
| guard-mode | pass | pass | pass | pass | pass | pass |
| lifetime-stats | pass | pass | pass | pass | pass | pass |
| live-power-flow | pass | pass | pass | pass | pass | pass |
| live-signal-sparklines | pass | pass | pass | pass | pass | pass |
| live-signals | pass | pass | pass | pass | pass | pass |
| location-favorites | pass | pass | pass | pass | pass | pass |
| location-map | pass | pass | pass | pass | pass | pass |
| maintenance-tracker | pass | pass | pass | pass | pass | pass |
| media-history | pass | pass | pass | pass | pass | pass |
| media-now-playing | pass | pass | pass | pass | pass | pass |
| mileage-stats | pass | pass | pass | pass | pass | pass |
| monthly-mileage | pass | pass | pass | pass | pass | pass |
| motor-history | pass | pass | pass | pass | pass | pass |
| motor-performance | pass | pass | pass | pass | pass | pass |
| mqtt-status | pass | pass | pass | pass | pass | pass |
| next-charge-decision | pass | pass | pass | pass | pass | pass |
| notification-stats | pass | pass | pass | pass | pass | pass |
| odometer-counter | pass | pass | pass | pass | pass | pass |
| onboarding-checklist | pass | pass | pass | pass | pass | pass |
| position-heatmap | pass | pass | pass | pass | pass | pass |
| power-flow-history | pass | pass | pass | pass | pass | pass |
| projected-range | pass | pass | pass | pass | pass | pass |
| quick-nav | pass | pass | pass | pass | pass | pass |
| range-bar | pass | pass | pass | pass | pass | pass |
| range-estimate | pass | pass | pass | pass | pass | pass |
| recent-drives | pass | pass | pass | pass | pass | pass |
| recent-drives-list | pass | pass | pass | pass | pass | pass |
| recently-unlocked-achievements | pass | pass | pass | pass | pass | pass |
| regen-efficiency | pass | pass | pass | pass | pass | pass |
| route-efficiency | pass | pass | pass | pass | pass | pass |
| safety-features | pass | pass | pass | pass | pass | pass |
| safety-history | pass | pass | pass | pass | pass | pass |
| security-status | pass | pass | pass | pass | pass | pass |
| sentry-event-log | pass | pass | pass | pass | pass | pass |
| signal-catalog | pass | pass | pass | pass | pass | pass |
| signal-health | pass | pass | pass | pass | pass | pass |
| signal-log | pass | pass | pass | pass | pass | pass |
| sleep-efficiency | pass | pass | pass | pass | pass | pass |
| software-update-history | pass | pass | pass | pass | pass | pass |
| software-update-status | pass | pass | pass | pass | pass | pass |
| solar-production | pass | pass | pass | pass | pass | pass |
| speed-heatmap | pass | pass | pass | pass | pass | pass |
| speed-profile | pass | pass | pass | pass | pass | pass |
| state-timeline | pass | pass | pass | pass | pass | pass |
| subscriptions | pass | pass | pass | pass | pass | pass |
| supercharger-history | pass | pass | pass | pass | pass | pass |
| system-health | pass | pass | pass | pass | pass | pass |
| telemetry-errors | pass | pass | pass | pass | pass | pass |
| tire-pressure-history | pass | pass | pass | pass | pass | pass |
| tire-pressure-visual | pass | pass | pass | pass | pass | pass |
| trip-summary | pass | pass | pass | pass | pass | pass |
| uptime-monitor | pass | pass | pass | pass | pass | pass |
| vampire-drain | pass | pass | pass | pass | pass | pass |
| vehicle-access | pass | pass | pass | pass | pass | pass |
| vehicle-hero | pass | pass | pass | pass | pass | pass |
| vehicle-hero-card | pass | pass | pass | pass | pass | pass |
| vehicle-specs | pass | pass | pass | pass | pass | pass |
| vehicle-twin | pass | pass | pass | pass | pass | pass |
| vehicle-upgrades | pass | pass | pass | pass | pass | pass |
| version-info | pass | pass | pass | pass | pass | pass |
| wall-connector | pass | pass | pass | pass | pass | pass |
| warranty-status | pass | pass | pass | pass | pass | pass |
| watch-summary | pass | pass | pass | pass | pass | pass |
| weather-at-car | pass | pass | pass | pass | pass | pass |
| weekly-digest | pass | pass | pass | pass | pass | pass |
| weekly-summary-card | pass | pass | pass | pass | pass | pass |
| year-review | pass | pass | pass | pass | pass | pass |

- Row 15 complete (trip replay layout fixes). Map cell is now `h-[55vh]` whenever stacked and `lg:h-auto lg:min-h-[440px]` side-by-side, so it fills the row and the transport attaches with no gap; the mounted `MapInvalidator` already re-runs `invalidateSize` on every container resize via ResizeObserver (verified: full tile coverage at all widths). Per-field Source/Timestamp/Age list moved off the panel face into a Sources drawer (icon-only Info trigger in the panel header). Both raw ISO instants (panel caption + drawer rows) now render through `useDateFormat` with the ISO kept on `<time dateTime>`. Style-switcher mismatch fixed at the root: react-leaflet updates only url/opacity/zIndex on a mounted TileLayer, so the free-tiles dark CSS filter (construction-only) desynced from the selection; the layer is now keyed on provider + effective style and remounts on every switch. i18n: +1 key (`replay.sources`). Tests: TripReplayPage 24/24 (4 drawer/timestamp migrations incl. the negative-age case, +1 face-timestamp test, motion partial-mock for the drawer); TripReplayMap + MapTileLayer suites green. Browser (Edge, mocked drive): 375 + 768 stacked at exactly 55vh, 1440 side-by-side with equal heights, 0px map-to-transport gap, no ISO in visible text, Dark↔Streets round-trip keeps filter and selection in sync, drawer opens with sources; screenshots `row15-replay-{375,768,1440}.png`. Gates: tsc, touched-file + full lint, audit 0, production build. Negative `Age` values logged under Report-only findings (calculation-owned, untouched).
- Row 14 complete (Map overview `/live` on the trip-replay model). Merged the Vehicle status brief, live map, Location details and Quick links into one `GlassPanel` hero: `lg:grid-cols-[minmax(0,13fr)_minmax(300px,7fr)]` (65/35) on desktop, map-above-panel stacked below `lg`. Panel: observed speed, heading as compass + rounded degrees (`NE (42°)`), last observed date + relative time, at home / at work / HomeLink, odometer, one-line coordinates with copy button. Header: title + Navigation route / Geofences / Locations icon buttons (guarded navigate preserved) + Details + `FreshnessDotAuto(latest)` last; `StaleRefreshWarning` covers retained refresh failures. The brief's scope/methodology/source text moved to a Details drawer ("Sources and method") instead of being deleted. Compass helper extracted from NavigationRoutePage to shared `lib/heading` (13 unit tests). i18n: +5 keys, −4 unused keys, split regen + check. Tests: MapOverviewPage 37/37 (was 32/36; +1 copy test; 8 brief-dependent tests migrated, Quick-view double-Close disambiguated); NavigationRoute 39/48 identical to HEAD baseline (9 pre-existing); MapsOperationalBrief 27/32 pre-existing (file untouched). Browser (Edge, mocked API): 375 + 768 stacked, 1440 side-by-side at exactly 65.0/35.0, no horizontal overflow, dot last in header, 0 nested surfaces; screenshots `row14-live-{375,768,1440}.png`. Gates: tsc, touched-file + full lint, audit 0, production build.
- Row 13 complete (extended button sweep to zero). Handoff verification: `a788dfe5f7` (299 files) already held the row 11 + 12 code and the row 13 conversions; the handoff commit only wired lint + plan, leaving the guard script, its test and the 16 header screenshots untracked — all committed here. The audit reported 7 findings: 6 `IconButton variant="secondary"` (now ghost by default) and the TariffLab draft-rate Remove without a confirmation step (gained a `confirm` dialog with new catalog keys `confirm.removeDraftRate.title/message`). Also converted the icon-only RbacMatrix Refresh Button to the shared IconButton (busy + tooltip) and removed its dead `cn` import. Guard hardened: `DESTRUCTIVE_LABEL` also matches bare literal labels; new audit-test case for the destructive-confirmation rule (8/8 node tests pass). Restored responsive target classes the conversion had dropped (Sql/Grafana Clear, QuietHours Edit/Delete). Migrated 11 tests: 8 Clear flows through the confirm dialog (TariffLab dialog pattern; the clear lands before the pending-copy resolve to preserve the stale-copy guard ordering), QuietHours delete text-query to role query, Grafana wrap-class expectation to the icon-only sizing. Remaining failures in row-13 files are pre-existing and queued: Grafana `grafana-panel-f01` catalog text (1), TariffLab card-face drift (32, documented), FlagsTable.phase6 expansion trigger (2, verified identical without the change). Registered the audit in `audit-registry.json` (full lint was red without it). Gates: audit 0 findings, guard 8/8, `tsc --noEmit`, full lint, production build (existing CSS/bundle warnings only).
- Row 13 detection (before changes). `audit-freshness-actions.mjs` now also covers Undo, Redo, Auto arrange, Reset, Columns, Density, Share, Print, Copy / Copy link, Expand / Collapse (all), Edit, Delete, Remove and Clear, classifies Delete / Remove / Reset / Clear as destructive, and rejects an `IconButton` with an empty label. Detected icon + visible-text cases: **41** (12 tool actions, 29 destructive by label), plus 6 overflow-menu items that keep their text. Classification:

  | classification | count | cases |
  |---|---:|---|
  | icon-only | 11 | Share — `DriveDetailPage`, `DriveDetailHeader`, `ChargingDetailPage`; Edit — `FlagsTable`, `RbacMatrixPage`, `ChannelCard`, `QuietHoursPanel`, `ChatMessageItem`; Auto arrange — `DashboardPage` edit mode; Columns — `DataTableColumnMenu`, `DataTableColumnsMenu` |
  | keep text (menu item) | 1 | Copy link — `PresentationModeSegment` popover list |
  | destructive, icon-only, already confirms | 16 | Remove (row) — ownership `ChargingReconciliation`, `ConsumablesLifecycle`, `DataGovernance`, `DriverAttribution`, `InsuranceTelematics`, `JurisdictionCompliance`, `SubscriptionROI`, `TariffLab` (policy row), `WarrantyCommand`; Delete — `QuietHoursPanel`, `FlagsTable`; Remove — `FleetSetupSubscribePanel`; Reset layout — `DashboardPage`; bulk Delete — `ExportsPage`, `AlertRulesPage`, `ChargingPlacesWorkspace` |
  | destructive, icon-only, needs a confirmation step | 9 | Clear editor — `SqlPlaygroundPage`, `DashboardsPage`, `GrafanaPanelPage`; Clear stream — `LiveLogsToolbar`, `LiveSignalTail`; Reset — `WhatIfPage`, `ScenarioControls`, `AmbientTypographyHUD`; Remove draft rate — `TariffLabPage` |
  | keep text (flow CTA) | 1 | Reset (per category) — `ResetSection`, the settings danger zone's reset flow, which already confirms |
  | icon-only, not destructive (nothing is lost) | 3 | Clear selection — `DataTableBulkBar`; Reset filters — `AuditLogFilters`; Clear filters — `RepairCaseFiltersBar` |

- Row 11 complete (freshness and icon-action sweep). Detection is automated by `web/scripts/audit-freshness-actions.mjs` (TypeScript AST over every non-test `src/**/*.ts(x)`), which also became the guard (`npm run audit:freshness-actions`, part of `npm run lint`, with its own `node --test` suite). It flags (a) the old freshness indicator — Wi-Fi / WifiOff icons from lucide or the icon registry, rendered "just now" text, the chip `DataFreshness` / `DataFreshnessAuto`, `FreshnessIndicator`, last-sync / updated-at badges; (b) icon + visible-text buttons and links for repeated actions (Refresh, Reload, More, Customize, View history, History, Export, Download, Filter(s), Settings, Configure, Options) by `common.*`/feature keys or literal labels; and (c) a filled icon-only repeated action (only Customize may be filled).

  | detection | before | after |
  |---|---:|---:|
  | (a) old freshness indicator | 76 | 0 |
  | — Wi-Fi / WifiOff icon imports and `Icons.wifi*` | 28 | 0 |
  | — chip `DataFreshness` / `DataFreshnessAuto` | 20 | 0 |
  | — `FreshnessIndicator` | 2 | 0 |
  | — "just now" text and justNow keys (undocumented) | 26 | 0 |
  | (b) icon + text repeated actions | 52 | 0 |
  | (c) filled icon-only repeated actions | 16 (after conversion) | 0 |

  Fixes: the freshness component is now only the dot (`FreshnessDot` / `FreshnessDotAuto`, renamed across 118 files; the chip, its Wi-Fi glyphs and visible age text are gone; age, status, source and exact last-update time are in its tooltip and accessible name). `FreshnessIndicator` is deleted (its `useIsStale` hook moved to `useIsStale.ts` with its tests); its two users render the dot. Wi-Fi glyphs are removed from the icon registry and the code: live/streaming states use `Radio`, offline/disconnected use `CloudOff`. The System Status live pill and `LiveIndicator` keep their state dot + word and move the update age into the tooltip; the tire widget caption moves the reading age into its tooltip. 44 repeated actions became the shared `IconButton` (37 by codemod, 7 with `ref` / `aria-describedby` / `data-tour` support added to `IconButton`); 16 that had been filled are now ghost. `IconButton` is ghost by default — no border or background at rest, including when disabled — with the subtle hover fill and the accent focus ring; Customize is the only filled icon action. Remaining allowed cases, each documented in code with a reason (`relative-time:` / `flow-cta:` markers the guard honours): 30 event-time or tooltip-only "just now" labels (feeds, recents, incidents, backups, automation runs, security events, the shared `dateFormat` helpers, the dot's own tooltip, the watch face which has no hover/focus), 8 download/export buttons that are the primary call to action of their dialog or panel (export-job drawer, evidence pack, DNA genome, energy plan, signed resale report, TOTP backup codes, share-card SVG, support bundle), and 2 overflow-menu items (Export in the dashboard More menu and the automation card menu) that keep text because the menu is where the label is read.
- Row 12 complete (page header alignment): `PageActions` now renders scope selectors (vehicle, range, Layout) as their own wrappable zone and puts the freshness dot, metadata badges and every command into ONE right-aligned, non-wrapping group (dot → secondary → destructive → overflow → primary, 6px gaps, vertically centred). Compact page headers (`PageContainer` and `PageHeader`) are a wrapping row: the title first, the group joining its row when it fits and otherwise wrapping below, right-aligned; the dashboard Layout selector takes its own row below `sm` and shares the row with the group from `sm`. Edge measurements on Fleet operations, dashboard, charging and settings at 375px, 768px, 1024px and 1440px: the group's controls share one row centre on every page and width, gaps are 6px, the group is flush right, and there is no horizontal overflow; screenshots are in `docs/ui-simplification/header-*.png`.
- Row 9b complete (drive Overview): the Overview is one surface modelled on trip replay — the route map (~60%, `lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]`) beside a journey panel, stacked map-first below `lg`. The panel tells the journey in order: Start (place, time, battery) → leg (distance · duration, with named comparisons vs this vehicle's average) → Destination (place, time, battery), then the key numbers Energy used / Consumption / Drive cost. Below it, one grid with the same column count per row (2 + 2 on phones/tablets, 4 on desktop) holds Average speed, Maximum speed (vs record), Battery use per 100 km and Odometer. The former Journey details and Route sections are merged into the hero (`#journey` / `#route` remain valid anchors there; the jump bar drops those two stops), so each value appears once on the page; the stacked Overview / Drive summary / Performance and comparisons headings and repeated review icons are replaced by one heading and one Details drawer that holds the per-field sources (summary source, recorded score, energy and cost basis, battery endpoints, odometer evidence, battery-rate basis, estimated-consumption note). When no route path is recorded but start/end coordinates exist, the map shows both pins joined by a dashed straight line with a "Route path not recorded" note (a single pin when only one endpoint exists; (0, 0) no-fix placeholders ignored); the empty map appears only when there are no coordinates. Calculations unchanged. Edge screenshots at 375px, 768px and 1440px for a populated drive, a sparse in-progress drive, and a drive with coordinates removed are in `docs/ui-simplification/row9b-*.png`; measured hero cells 680/454px at 1440 (side by side) and stacked at 375/768, one heading, grid rows 1 (desktop) / 2 (narrower), no horizontal overflow. The remaining "Energy and range evidence" table in the Energy tab still lists energy, odometer and battery used with their source and method; it is the source audit for those values, left in place for review. Drive-detail, report-layout and page suites: 528 tests, 521 pass; the 7 remaining failures are the pre-existing useDriveDetailData ones (the previously failing HeroGauges 11 and DriveDetailComposition 1 now pass under the rewritten tests). New JourneySequence and route-endpoint tests added. eslint, `tsc --noEmit`, split catalog, accessible-name, touch-target, landmarks, sr-only, empty-state and typography audits pass.
- Row 10 complete (exact accent): the primary/accent tokens are now exactly the selected hex. Removed `presentationAccent` (hue-preserving lightness/saturation remap plus contrast shift) and the Signal Blue override that applied `#91b4d2` / `#385e7e` instead of its `#3b82f6`. Contrast is handled only by `--theme-on-primary` / `--theme-on-accent` (dark or white text, whichever reads better). Each preset swatch is painted solid with its one source hex (no gradient), and the pre-JS CSS default is the default preset's exact hex. Solid uses render the exact hex: primary buttons, active nav indicator, selected cards and checkmarks, tabs (TabNav selected border), toggles (on track; the thumb takes the on-accent colour) and focus rings (`--focus-ring` now follows the accent). This overrides the earlier contrast-adjusted shades, so the accent itself no longer carries a 4.5:1 surface-contrast guarantee; text tokens still do. New `e2e/accent-exact.smoke.spec.ts` asserts, for all five presets and a custom colour in dark and light, that the root token and a visible primary button's computed background equal the selected hex: 12/12 pass in Edge against the dev server. ThemeProvider, ThemePicker, Toggle, TabNav, Tabs and Button suites pass 141/141 after their assertions moved from derived shades to the exact hex. Screenshots with no menus or overlays open (Tesla Red dark, Solar Amber light, Matrix Green dark, custom `#7c3aed` light) are in `docs/ui-simplification/accent-*.png`; measured token, primary button, nav indicator and focus ring all equal the selected hex.
- Row 9a complete (chart summaries inside their cards): `ChartCard` gained a `summary` slot rendered between the title and the chart, and `ChartSummary` renders a compact key-value row (equal columns, units in the label, values passed pre-formatted so no number or calculation changes). Drive detail now keeps every chart's values in its own card: Elevation profile (Elevation gain / Elevation loss / Net elevation, m), Power profile (Max power / Max regen / Avg power / Mean sampled power, kW; Min moving speed in the speed unit; its method caption moved inside the card), Drive overview (the Signal / Mean / Max / Min table and its caption), Temperatures (outside / inside / driver / passenger averages, climate, fan) and Tire pressure (per-wheel pressure range). Bare "Gain", "Loss", "Net" and "Min speed" labels are gone; the telemetry card no longer repeats "No telemetry data available" as an empty table row. Repo sweep: an AST scan of every `ChartCard` / `ChartContainer` / `EmbeddedChart` (and custom `*Chart` components) for summary tables, stat rows or captions rendered as JSX siblings found only the five drive-detail cards (the scan reproduces all five against the pre-change files). The other hits were already inside the chart's own card (Battery level at charge start, Weekly charging heatmap's data-table accordion) or are section-level briefs rather than a chart's own stats (Notification activity brief); a surface-chain review of the 14 files that render both a chart and a table/stat block found each block in its own titled panel. Edge screenshots of the Power, Elevation and Temperature cards at 375px, 768px and 1440px are in `docs/ui-simplification/row9a-drive-*.png` (the drill drives carry no per-sample telemetry, so they show summaries with the chart empty state; populated values are covered by the component tests). Drive-detail and layout suites: 1,511 pass; the 21 remaining failures (useDriveDetailData 7, HeroGauges 11, DriveDetailComposition 1, WorkspaceHeader 2) fail identically without this change. eslint, `tsc --noEmit`, the chart a11y audit and the split catalog check pass.
- Row 8 complete (status bar): the bar is one non-wrapping row at every width with a fixed row height (`--shell-status-bar-row`: 44px below `xl`, 28px at `xl`) and 8px item gaps (12px at `xl`); the old two-row 7rem phone bar is gone. Priority tiers: desktop shows every item labelled; tablet (768-1279px) keeps API, Live and More labelled and shows Guessed, Now, alerts, Recent and Helix as icon + status dot with tooltips; phone (<768px) keeps API, Live, alerts and More, and moves Guessed, Now, Recent and Helix into the More menu as labelled rows with their values. If the row measures wider than the bar (long translations, large text) it steps down a tier, ending in an icon-only `compact` tier, so nothing is clipped or unreachable. More's dots icon and label are now inline. Every bar trigger is 44px below `xl`; the bar pads for the bottom safe area whenever it is the lowest bar. Edge screenshots at 375px, 768px, 1024px and 1440px in light and dark (plus the open phone More menu) are in `docs/ui-simplification/statusbar-*.png`; measured: one row centre at every width, bar height 44px below `xl` / 28px at 1440px, all targets 44px below `xl`, page horizontal overflow 0 at 375px. Status-bar and Layout suites pass 352/352; split catalog check, eslint and `tsc --noEmit` pass on the changed files.

- Row 5 checkpoint: `ChargingSummaryBrief` defaults to embedded because charging call sites commonly render within summary cards, panels, and sections; explicit `variant="standalone"` remains available for genuinely standalone placements. Its regression confirms embedded mode and absence of a standalone surface. The two direct page `OperationalBrief` usages are page-level siblings rather than nested cards. Charging feature suite: 1,812 passed / 252 failed across 125 files; the focused `ChargingSummaryBrief` suite passes 8/8. Split catalog check, full lint, and `tsc --noEmit` pass. Failures remain under the pre-existing charging failure triage; row 5 stays in progress.
- Row 6 started: `VehicleOperationalBrief` exposed an `embedded` prop that changed its heading but failed to forward the embedded surface variant. It now forwards the variant and has a direct regression proving its standalone surface is absent. The regression passes; the existing broader wrapper test file has nine older expectation failures for the evidence-card behavior (hidden missing metrics, drawer-only metadata/status), which remain tracked for the scheduled full-suite repair.
- Row 6 dashboard/data-display follow-up: shared `OperationalBrief` metric rows now accept `maxPerRow` and share the balanced row distributor with `StatStrip`; six metrics render 3+3 and four render 2+2. Dashboard expand controls moved left of the freshness dot with no reserved header space; titleless freshness uses the same 16px corner inset. `WidgetShell` now routes retained-data retry through the dot and hides the duplicate stale-warning action. Fleet Posture no longer imposes an inner scroll area, and the Battery gauge no longer repeats its title as a caption while preserving its accessible meter name. The six focused shared/dashboard test files pass 111/111. Browser verification at 375px, 768px, and 1440px confirmed metric-bank counts `3,3,2,2,3` on Analytics/Driving and a 16px freshness inset on Battery at each viewport; screenshots are saved under `docs/ui-simplification/row6-*`.

- Row 4 complete: vehicle evidence panels, Tesla Physics, Vehicle List, vehicle detail, access, and cockpit summaries use the shared evidence-card patterns; missing values and drawer-only details are reflected in the regression assertions. The seven focused vehicle suites pass 239/239. Split catalog check, lint, typecheck, and production build pass. Browser screenshots at 375px, 768px, and desktop remain unavailable because this session has no in-app browser tool.

- Row 1 complete: added IconButton with caller-provided accessible label, tooltip, variants, route-link mode, busy/disabled behavior and menu ARIA props. Focused suite passed 3/3; standalone typecheck, full lint, and production build passed. No catalog key was needed because every label is passed in by the caller.

- Row 2 complete: WidgetShell renders freshness after other header actions, with a state dot, age, and a separate icon-only refresh action. Eight widgets with known poll intervals now pass those cadences; manual indicators go stale after 15 minutes and automatic ones after two missed intervals. All indicators share one 30-second ticker, and the dot pulses once only when status changes. The DataFreshness and WidgetShell tests pass 69/69; the eight affected widget tests pass 218/218; `tsc --noEmit`, full lint, and build pass. No new copy or catalog keys were needed. Existing empty-state tests now identify the specific empty-state status region after the shared freshness status was added.
- Row 0 complete after handoff correction: `OperationalBrief` supports `standalone` and `embedded`; dashboard summaries default to embedded, and Quick Stats, Glance, and Fleet Posture callers are explicitly set to the appropriate mode. The inner attention row is flat. Updated the evidence-card tests to assert missing fields and metadata in the drawer, as required by the spec. Focused OperationalBrief, DashboardSourceBrief, AnalyticsSummary, and FleetPosture suites pass 58/58; split catalog check, typecheck, full lint, and production build pass. Added one complete-sentence analytics empty-state key and regenerated the split locale bundles.
- Row 2 follow-up complete: removed the whole-widget green glow; new data pings the dot twice, stale uses an outlined warning ring, failed uses a slow red pulse, and reduced motion disables those animations. Retained content dims to 45% when stale or failed. Widget headings truncate and expose the full title. Focused freshness/shell tests pass 71/71; typecheck, full lint, and production build pass. The broader exploratory dashboard widget run reports 3,617 passing and 220 failing tests across 172 files; failures are queued for the ordered full-suite repair after simplification, since the full suite was explicitly deferred until then.
- Row 3 started: the eight widgets with existing automatic polling now provide their refresh interval to the shared header. Shared dashboard stat tiles use flat, wrapping 200px bases, stacked labels/values, no decorative icons, and optional `maxPerRow` (`cols` remains compatible). Tip and status lists now use flat rows with hairline dividers. The four affected shared-component suites pass 77/77; typecheck, full lint, and production build pass. The dashboard inventory still needs review for nested surfaces, repeated actions, and unsupported freshness sources.
- Row 3 checkpoint: Fleet Posture now uses the shared freshness control and no longer duplicates its text Refresh action. Onboarding Checklist refreshes all three prerequisite queries from the shared control and uses the oldest successful prerequisite timestamp; this applies to both active and dismissed states. Focused widget tests pass 26/26. `npx tsc --noEmit`, full `npm run lint` (all registered audits), `node scripts/split-i18n-catalog.mjs --check`, and `npm run build` pass. Build retains the known CSS parser and startup bundle warnings. Quick Nav is static navigation content without a data source, so no freshness indicator applies. Browser screenshots are unavailable because no browser tool is exposed; continue with focused tests/render checks and record this constraint at final review.
- Row 3 complete: every dashboard `DashboardSourceBrief` (47 widget usages) renders embedded; the two page-level summaries explicitly remain standalone. Fleet Posture's direct brief is embedded too. Surface scan found no remaining card-inside-card widgets: `WidgetDetailCard` is a `KVList`, and the only dashboard `<Panel>` grep hit is a `PanelTitle`. Freshness source scan found all live-data widget files covered (147 of 148); Quick Nav is static and has no freshness source. Shared icon-only actions cover both Digital Twin Open links, both Recent Drives View all links, Signal Log Pause/Resume, and Onboarding Dismiss. Other direct buttons are flow or item actions, not repeated toolbar actions. The six suites pass 144/144. Typecheck, full lint/audits, build, and catalog check pass. Empty-state cleanup remains tracked separately; no `no-action:` comments were added in these row changes.
- Shared-header follow-up: the freshness dot is now the per-widget refresh control; controls stay in a compact right cluster; hover-only expand controls sit to its left without reserving header width; retained-data warnings do not duplicate the dot's retry; widget bodies avoid nested summary scrolling. Title-equal `WidgetBigNumber`/`WidgetStatGrid` captions are hidden, as is Battery's repeated `LinearGauge` caption. Climate's duplicate brief heading is suppressed while its title remains available in details. Analytics fleet overview now uses an embedded brief. Both StatStrip and OperationalBrief accept `maxPerRow` and distribute 6 items as 3+3 and 4 as 2+2. Captured Edge screenshots at 375px, 768px, and 1440px are in `docs/ui-simplification/row6-analytics-driving-after-*.png` and `row6-battery-widget-after-*.png`; measured Battery dot inset is 16px at all three widths, and the duplicate caption is absent. Focused shared/dashboard tests pass 111/111. Add `rg -n '<(OperationalBrief|DashboardSourceBrief|ChargingSummaryBrief|VehicleEvidenceBrief)' web/src` and `rg -n 'maxPerRow|data-max-per-row' web/src` to the final surface review.
- Nested-surface trace follow-up: `StatisticsBatteryBrief`, `FsdOperationalPanel`, Benchmark privacy briefs, Next Charge, Automation Activity, System Command Center, Service Intelligence, and Quiet Hours now set `variant="embedded"` inside their existing `LayoutCard`/`GlassPanel`. Regressions cover the analytics overview, Statistics battery, and weekly FSD surface mode. Split check, typecheck, full lint, and build pass. The relevant suites expose existing assertion drift from missing values/details moving off the card face; totals and follow-up are in `docs/finish-progress.md`.

- Row 4 started: vehicle evidence briefs now accept standalone/embedded variants. Physics Cockpit and Tesla Physics briefs inside LayoutCard surfaces, plus vehicle battery/charging detail briefs inside GlassPanel surfaces, use embedded mode. Vehicle Access refresh controls are icon-only; empty drivers/invitations states have real actions. Charging telemetry's self-populating empty state now uses the shared informational variant and explains when data appears. Evidence, charging telemetry, battery range, Vehicle Access, and Physics Cockpit suites pass (10/10, 10/10, 13/13, 33/33, 17/17). Tesla Physics last reported 24 failures (43/67 passing) while summary context and missing-field assertions are being moved into the Review details drawer. Vehicle List last reported 21 failures (101/122 passed); many assertions still expect missing metric placeholders or methodology on the card face. Row 4 is not complete or committed.

## Decision log

| row # | situation | decision | why |
|---|---|---|---|
| 1 | `Tooltip` already owns hover/focus/touch/Escape behavior and Button owns busy/disabled button state. | Compose these primitives; link mode uses React Router `Link` with the shared button tokens. | Keep behavior and visuals shared and avoid another tooltip implementation. |
| 0 | User requested catalog discipline for every new user-facing string. | All new copy will be added as a complete-sentence `en.json` key and called through `t()`; counted text uses i18next `count`; run split check after each catalog edit. | Explicit user requirement and task guardrail. |
| 2 | Initial freshness checkpoint still used a whole-widget glow and did not dim stale retained content. | Move the two-cycle ping to the fresh dot, use state-specific ring/pulse shapes, dim retained content to 45%, and remove the shell glow. | Match the written C spec and keep motion local to the indicator. |
| 3 | Dashboard KPI tiles use the shared StatCard inside a single WidgetShell surface. | Preserve StatCard's shared metric formatting while rendering the dashboard group as flat flex-wrapped tiles and omitting decorative icons. | Remove nested boxes and meet the A/D metric layout without per-widget copies. |
| 0 | User reordered gates and full test execution. | Build, standalone typecheck, lint, and split check pass before simplification; full Vitest follows simplification. | Latest user priority order. |
| 0 | Task requires commits to stay build/lint/typecheck green. | Keep those checks on each shared-component or migration commit; targeted tests per row, then full Vitest at requested stage. | Task hard rule. |
| 13 | TariffLab draft-rate Remove only edits an unsaved draft. | Still confirm first. | Spec rule: destructive icon-only actions confirm; typed rate data is lost. |
| 13 | Grafana Clear test expected the old text button's wrap classes. | Restored the button's own `min-h-11 md:min-h-10` in product; migrated the expectation to those. | `h-auto`/`max-w-full`/`whitespace-normal` came from `wrapLabel` for the removed text label; touch-target intent preserved. |
| 13 | Sibling `confirm.*` keys exist only as t() fallbacks. | New `confirm.removeDraftRate` keys added to en.json + split regen. | Task hard rule and row-1 decision require catalog keys; no count-based test blocks it. |
| 14 | Removing the brief orphans its methodology/honesty text. | Kept a Details drawer ("Sources and method", drive-Overview model). | Preserves user-facing context + drawer test intent without a nested surface. |
| 14 | Heading was `42.00°`; request shows `N (2°)`. | Cardinal + `Math.round` degrees (Navigation route pattern). | Closest existing parallel; underlying value unchanged. |
| 14 | Compass helper lived in NavigationRoutePage. | Extracted to shared `lib/heading`; page imports it. | No per-page copies; zero behavior change (suite identical to HEAD). |
| 15 | Sources list could go in a drawer or a collapsed section. | Drawer with icon-only Sources trigger (row-14 pattern). | Matches the evidence-disclosure language; keeps the panel face to live values. |
| 15 | Timestamp assertions need a deterministic zone. | Structural: ISO on `<time dateTime>`, display is formatted non-ISO. | Exact rendering is the hook's tested job; system tz varies by machine. |
| 15 | Tile layer className never updates after mount. | Key the layer on provider + effective style (remount on switch). | Makes selection-match-tiles true by construction; tile reload cost unchanged. |
| 7 | Exit check wants one ticker + no grid re-render per tick, but DashboardPage has a pre-existing 60s re-render tick (on main since an old refactor) and useIsStale has per-instance 10s timers (3 page-level usages, none in the grid); grid/shell are unmemoized. | Log as pre-existing, out of scope; no perf refactor. | Freshness age labels (this branch's scope) already use the one shared singleton ticker; the page tick may serve inline age labels that read at render time, so memoizing risks stale labels for a 1/min reconciliation. |

## Report-only findings

- Baseline build emitted CSS warning `Unexpected "$"` at generated input `hue.bg-$`; build still exited 0.
- Baseline bundle report warns startup JS is 404.8 KB against 400 KB; non-failing.
- Row 15: negative `Age: -X.XX s` in replay per-field sources. Nearest-telemetry alignment can select a future row, so `positionTs - sourceTs` goes negative (see the "Signed age" comment in TripReplayPage). Timestamp ordering / clock issue, calculation-owned; the UI renders the signed value unchanged (locked by the "reveals future telemetry as negative age" test).
- Group 26: the `invalid` metric valueState is a dead contract -- `OperationalBriefMetric` declares `'value' | 'missing' | 'invalid'`, but no producer in the metrics pipeline has ever set `'invalid'` (verified via history search) and both the brief face and drawer filter to `'value'` only. Known-bad readings (e.g. NaN tire pressure) therefore omit their tile exactly like unknown data instead of an Invalid marker. Pipeline + brief change, needs product say on the invalid presentation; the science test pins omission-with-explanation in the meantime.

## Summary

Done. All checklist rows are done, none blocked. Branch `ui/simplification` (from `fix/dashboard-followups` at `7570c940ec`). Closing series (tip-first): `2cf61b41f0` trio-merge record docs, `939aaa5cd3`/`a8d4618f28`/`a09665349e`/`93211830ba` wave 5a-d (111 copy interactions), `dbb81c8738` flags gallery refresh, `4dc74079b3` merge follow-ups, `e512fc53cd` trio merge, `92541a1406` guard sweep + gallery + handoff, `ec304ba059` rows 5/6 closeout, `33778c1d95` row-7 exit fixes, `b6ffb54d6b` wave-4 closeout, `1b83deaf66`/`eaa5cd8f41`/`2809bbcd9a`+`ce9c23bcce`/`f44c30e579` wave-4 folders, `0de3ba882f` MapTileLayer fix, `bca2df7b44` wave-3 closeout.

Shared components + props (this span): no new shared components. `audit-sr-only.mjs` allowlist +2 test-only detection entries (precedent-backed, documented inline). Production hunks, all in-folder and each pinned by a pre-existing unweakened test: DashboardPage ACTION_TARGET touch targets (review-by-revert), SessionsPage `exportData={monthlyData}` (source-contract pin), GasTrendChart model-native `price_per_unit` dataKey (value-neutral), FirmwareImpactPage 1-char constraint fix, MapTileLayer resolved-tiles marker. No props added/deprecated/removed; no data-layer changes (no model, query, or calculation edits anywhere in the closeout span).

Rows done: 0-19 incl. 5 (charging), 6 (remaining features), 7 (exit check). Test-repair closeout: waves 3+4 resolved 1118 fails, then `ui/i18n-trio` merged (trio 7,672/0 on the merged tree) and wave 5 repaired its 111 copy interactions; final suite 56,877 passed / 80 failed with 0 regressions — remaining are trio-class 6 (pre-existing on the trio branch, trio follow-up), 52 proven pre-existing, 22 documented blocks, 0 active flakes. Gates: tsc, eslint + 40 audits, production build, guard sweep 277x4 with 0 violations + refreshed route gallery (554 JPEGs).

Decision highlights for human review: (1) the 5 production hunks kept per pre-existing pins (see finish-progress.md); (2) sr-only audit allowlist extension instead of rewriting test assertions; (3) i18n usage-manifest regen (+3 debugger keys, 0 missing); (4) pre-existing 60s grid re-render tick logged out-of-scope (perf refactor risk); (5) 2 flakes documented, not fixed (incl. new JourneyAssurance order-dependent flake); (6) gallery error-boundary states kept as mock artifacts (verified identical to row-17). Open follow-ups: trio-class 6 + stale fallback defaults (trio follow-up); the 52 pre-existing + 22 blocks + ticker memoization are separate work, out of UI scope.





## Automated nested-surface sweep (2026-10-15)

The TypeScript AST inventory checks JSX evidence briefs against enclosing
`Card`, `GlassPanel`, `LayoutCard`, `Panel`, `SectionCard`, `SectionSurface`,
and `WidgetShell` surfaces, and compares direct heading text/i18n keys with
descendant card title text/i18n keys. The audit is `web/scripts/audit-nested-surfaces.mjs`;
the all-source guard is `node --test scripts/__tests__/audit-nested-surfaces.test.mjs`.

### Full pre-fix inventory

The baseline contained **38 nested standalone brief placements** and **4
duplicate heading/title pairs**. The complete brief inventory is listed
below; the first 31 placements were flattened during the first pass, and the
remaining seven were surfaced by the second pass before fixes.

Nested brief placements (38):

- `driving/components/arrival-reliability/ArrivalReliabilityWindowComparisons.tsx:130` — NestedDrivingBrief
- `driving/components/cold-start/ColdWarmComparison.tsx:118` — NestedDrivingBrief
- `driving/components/drive-detail/HeroGauges.tsx:217,224` — NestedDrivingBrief (2)
- `driving/components/drives-orchestrator/DrivesOverview.tsx:67` — NestedDrivingBrief
- `driving/components/drivetrain-health-modernization/LiveMotorPanel.tsx:180` — NestedDrivingBrief
- `driving/components/drivetrain-health-modernization/ThermalPanels.tsx:104` — NestedDrivingBrief
- `driving/components/driving-dynamics/AutopilotSection.tsx:121` — NestedDrivingBrief
- `driving/components/driving-dynamics/DrivingCoachSection.tsx:212` — NestedDrivingBrief
- `driving/components/driving-dynamics/GrokDynamicsBriefing.tsx:135` — NestedDrivingBrief
- `driving/components/driving-dynamics-modernization/GForcePanel.tsx:50` — NestedDrivingBrief
- `driving/components/driving-dynamics-modernization/RideOverview.tsx:69` — NestedDrivingBrief
- `driving/components/driving-dynamics-modernization/SpeedGearPanel.tsx:84,105` — NestedDrivingBrief (2)
- `driving/components/driving-rhythm/DepartureConsistency.tsx:101` — NestedDrivingBrief
- `driving/components/driving-rhythm/WeekdayWeekendComparison.tsx:106` — NestedDrivingBrief
- `driving/components/efficiency-target/GoalPulse.tsx:116,168` — NestedDrivingBrief (2)
- `driving/components/explorer/NewRepeatBehavior.tsx:94` — NestedDrivingBrief
- `driving/components/fsd-insights/FsdDriveAnalyticsPanels.tsx:180` — NestedDrivingBrief
- `driving/components/fsd-insights/FsdObservatoryPanel.tsx:105` — NestedDrivingBrief
- `driving/components/journey-fragmentation/EnergyIntensityPanel.tsx:66` — NestedDrivingBrief
- `driving/components/journey-fragmentation/StructureIndicators.tsx:30` — NestedDrivingBrief
- `maps/components/EfficiencyDetectivePanel.tsx:105` — MapsOperationalBrief
- `resale-vault/components/BatteryCertificatePanel.tsx:92` — VaultSummaryBrief
- `resale-vault/components/BatterySummaryPanel.tsx:42` — VaultSummaryBrief
- `resale-vault/components/DrivingChargingSummaryPanel.tsx:66,72` — VaultSummaryBrief (2)
- `resale-vault/components/IncidentSummaryPanel.tsx:33` — VaultSummaryBrief
- `resale-vault/components/MaintenanceSummaryPanel.tsx:36` — VaultSummaryBrief
- `resale-vault/components/SoftwareUpdateSummaryPanel.tsx:29` — VaultSummaryBrief
- `vehicle-systems/components/comfort-consistency/ComfortConsistencySourceAvailability.tsx:33` — SourceAvailabilityBrief
- `vehicle-systems/components/hvac-cycling/HvacCyclingSourceAvailability.tsx:35` — SourceAvailabilityBrief
- `vehicles/components/physics-ledger/DynamicsPanel.tsx:25` — LedgerEvidenceBrief
- `vehicles/components/physics-ledger/RangePanel.tsx:22` — LedgerEvidenceBrief
- `vehicles/components/physics-ledger/ThermalPanel.tsx:24` — LedgerEvidenceBrief
- `vehicles/components/physics-ledger/TiresPanel.tsx:26` — LedgerEvidenceBrief
- `vehicles/components/tesla-physics/PhysicsPageShell.tsx:82` — PhysicsEvidenceBrief

Duplicate outer heading and inner card title (4):

- `vehicles/components/physics-ledger/DynamicsPanel.tsx:20` — `physicsLedger.dynamics.title`
- `vehicles/components/physics-ledger/RangePanel.tsx:17` — `physicsLedger.range.title`
- `vehicles/components/physics-ledger/ThermalPanel.tsx:19` — `physicsLedger.thermal.title`
- `vehicles/components/physics-ledger/TiresPanel.tsx:21` — `physicsLedger.tires.title`

After the fixes, rerun the audit and record its nested-brief and duplicate
title counts here. The target is zero for both.

### Full nested bordered-surface extension

A second AST pass widened the inventory from evidence briefs to any bordered
surface component nested in another bordered surface. It found **26 nested
surface blocks** in addition to the 38 evidence-brief placements above; these
26 locations were added to the pre-fix sweep before being edited:

- `admin/components/structural-closure/fleet-api/FleetAPIConfiguredEndpoints.tsx:56` — GlassPanel inside LayoutCard
- `analytics/components/analytics/OverviewTab.tsx:200` — GlassPanel inside GlassPanel
- `analytics/components/weekly-digest/AlertsSection.tsx:88` — GlassPanel inside GlassPanel
- `analytics/components/weekly-digest/ChargingSection.tsx:143` — GlassPanel inside GlassPanel
- `analytics/components/weekly-digest/DrivingSection.tsx:160` — GlassPanel inside GlassPanel
- `analytics/components/weekly-digest-modernization/AlertsPanel.tsx:82` — GlassPanel inside LayoutCard
- `analytics/components/weekly-digest-modernization/BatteryPanel.tsx:59,67` — GlassPanel inside LayoutCard (2)
- `battery/pages/BatteryCellsPage.tsx:859` — GlassPanel inside LayoutCard
- `battery/pages/BatteryDegradationPage.tsx:762,850,870,887` — GlassPanel inside LayoutCard (4)
- `charging/pages/ChargeInterruptionPage.tsx:223` — Card inside LayoutCard
- `maps/pages/LocationsPage.tsx:364` — GlassPanel inside LayoutCard
- `notifications/components/alert-editor-source-closure/TemplateBrowser.tsx:56` — GlassPanel inside GlassPanel
- `notifications/components/packs/AlertPacksPanel.tsx:44` — GlassPanel inside GlassPanel
- `ownership/pages/WarrantyCommandPage.tsx:575` — Card inside Card
- `system/pages/ChatbotPage.tsx:929` — GlassPanel inside GlassPanel
- `telemetry/pages/SignalCorrelationPage.tsx:439,472` — Card inside GlassPanel (2)
- `telemetry/pages/SignalEntropyPage.tsx:290,304` — Card inside GlassPanel (2)
- `vehicles/components/vehicle-detail/BatteryRangeCharts.tsx:104,108` — GlassPanel inside GlassPanel (2)
- `vehicles/components/vehicle-detail/QuickLinksSection.tsx:49` — GlassPanel inside GlassPanel

Current pre-fix totals for the combined sweep: **64 surface/brief blocks**
(38 brief placements + 26 nested surfaces), with 4 duplicate title pairs.
After edits, the permanent AST guard reports **0 unresolved standalone
briefs, 0 nested bordered surfaces, and 0 duplicate title pairs** across
`src`. The 26 nested `Card`/`GlassPanel` children now accept
`variant="embedded"`, which removes their border, background, shadow, and
print-surface marker while preserving content padding. Ledger summaries keep
the outer section title and hide their repeated inner heading. The permanent
AST regression runs through
`node --test scripts/__tests__/audit-nested-surfaces.test.mjs`.
