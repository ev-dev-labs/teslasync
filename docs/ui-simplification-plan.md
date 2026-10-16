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
| 5 | `features/charging/**` | charging routes | evidence cards and nested panels | in progress | in progress | in progress | in progress | per row | 1 | in progress |
| 6 | remaining `features/*/**` | all remaining routes | evidence cards, repeated actions, nested cards | in progress | todo | todo | todo | per row | 1 | in progress |
| 7 | grep exit check, full gates and browser/e2e | app-wide | leftovers / summary | verify | verify | verify | verify | confirm | 0 | todo |
| 8 | `components/layout/StatusBar.tsx`, `status-bar/*Segment.tsx`, `index.css` shell bar geometry | app shell | bottom status bar (API / Live / Guessed / Now / Recent / More / Helix) | n/a | done | done | done | none | 2 | done |
| **9** | **Drive detail page restructure** | `/drives/:id` and same-pattern pages | row group | | | | | | | in progress |
| 9a | chart cards with detached summary tables/captions (grep: summary rendered as sibling of a chart card) | drive detail, then all matches | chart summary rows inside their card, self-explanatory labels with units | todo | todo | todo | todo | UI only; values and calculations unchanged | 0 | todo |
| 9b | drive detail Overview tab | `/drives/:id` Overview | map + journey info panel hero (trip replay model), one stat grid, one heading per section | todo | todo | todo | todo | UI only; start/end pins with dashed line when the route path is not recorded | 0 | todo |

Exit-check inventory (run from `web/`):

```sh
rg -n '<(OperationalBrief|DashboardSourceBrief|ChargingSummaryBrief|VehicleEvidenceBrief|DrivingSummaryBrief|FleetSectionBrief|SystemSummaryBrief|BatteryEvidenceBrief|VehicleOperationalBrief|TripOperationalBrief|SettingsSummaryBrief)' src
rg -n '<(GlassPanel|LayoutCard|Card|Panel|Section|WidgetShell)|data-operational-brief-surface=' src
rg -n 'maxPerRow|data-max-per-row|data-operational-metric-bank|data-columns=' src
```

Trace each result through composed parents and verify no block has more than one bordered/raised surface. Every nested brief must use `variant="embedded"` (including wrapper forwarding) or the outer surface must be removed. Review similar evidence-card wrappers beyond this named list as part of the `*Brief` usage inventory. Validate every metric grid's `maxPerRow` cap and balanced rows; six-tile groups render 3 + 3 and short rows have no orphan tile.

## Progress checkpoints

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

## Report-only findings

- Baseline build emitted CSS warning `Unexpected "$"` at generated input `hue.bg-$`; build still exited 0.
- Baseline bundle report warns startup JS is 404.8 KB against 400 KB; non-failing.

## Summary

In progress. Row 1 IconButton and row 2 shared widget freshness are complete. Row 3 dashboard widget rollout is in progress. Current branch is `ui/simplification`; started from `fix/dashboard-followups` at `7570c940ec`.





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
