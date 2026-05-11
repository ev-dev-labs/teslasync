# Phase-43 / Prompt 0081 — Route Coverage Audit

> **Status:** OK — every <Route> in web/src/App.tsx resolves to an
> existing module with a default export, 	sc --noEmit is clean, and
> 
pm run build exits 0.

## Summary

| Metric | Value |
|---|---|
| Total `<Route>` declarations in App.tsx | 108 |
| Lazy page routes (resolve to `features/*/pages/*.tsx`) | 106 |
| Layout wrapper route (`<Layout />` eager import) | 1 |
| `<Navigate>` redirects (no module backing) | 1 |
| OK | 108 |
| BROKEN | 0 |
| `tsc --noEmit` | clean (exit 0) |
| `npm run build` | clean (exit 0) |

## Methodology

1. Parsed every `<Route … />` JSX line in `web/src/App.tsx` (108 declarations).
2. Extracted the `lazy(() => import('./path'))` declarations and built a
   component → module-path map (104 lazy components).
3. For each lazy route, resolved its module path against the filesystem
   trying `.tsx`, `.ts`, `/index.tsx`, `/index.ts` extensions.
4. For each resolved file, scanned for `export default …` or
   `export { default …` declarations.
5. Ran `npx tsc --noEmit` (clean) and `npm run build` (clean) to
   confirm the resolved modules compile and bundle.

## Per-route table

| Route path | Component | Module file | Status |
|---|---|---|---|
| `*` | `NotFound` | `web/src/features/system/pages/NotFoundPage.tsx` | OK |
| `*` | `NotFound` | `web/src/features/system/pages/NotFoundPage.tsx` | OK |
| `/` | `Layout` | `web/src/components/layout/Layout.tsx` | OK |
| `<index>` | `Dashboard` | `web/src/features/dashboard/pages/DashboardPage.tsx` | OK |
| `admin` | `Admin` | `web/src/features/admin/pages/AdminPage.tsx` | OK |
| `admin/feedback` | `FeedbackQueue` | `web/src/features/admin/pages/FeedbackQueuePage.tsx` | OK |
| `alert-rules` | `AlertRulesPage` | `web/src/features/notifications/pages/AlertRulesPage.tsx` | OK |
| `alert-studio` | `AlertStudio` | `web/src/features/notifications/pages/AlertStudioPage.tsx` | OK |
| `alerts` | `Alerts` | `web/src/features/notifications/pages/AlertsPage.tsx` | OK |
| `analytics` | `Analytics` | `web/src/features/analytics/pages/AnalyticsPage.tsx` | OK |
| `anomaly-detection` | `AnomalyDashboard` | `web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx` | OK |
| `api-keys` | `APIKeysPage` | `web/src/features/admin/pages/APIKeysPage.tsx` | OK |
| `api-logs` | `ApiLogs` | `web/src/features/admin/pages/ApiLogsPage.tsx` | OK |
| `api-playground` | `ApiPlayground` | `web/src/features/admin/pages/ApiPlaygroundPage.tsx` | OK |
| `automations` | `AutomationsListPage` | `web/src/features/automations/pages/AutomationsListPage.tsx` | OK |
| `automations/:id/edit` | `AutomationBuilderPage` | `web/src/features/automations/pages/AutomationBuilderPage.tsx` | OK |
| `automations/list` | `AutomationListPage` | `web/src/features/automations/pages/AutomationListPage.tsx` | OK |
| `automations/new` | `AutomationBuilderPage` | `web/src/features/automations/pages/AutomationBuilderPage.tsx` | OK |
| `backup` | `BackupRestore` | `web/src/features/admin/pages/BackupRestorePage.tsx` | OK |
| `battery` | `BatteryHealth` | `web/src/features/battery/pages/BatteryHealthPage.tsx` | OK |
| `battery-cells` | `BatteryCells` | `web/src/features/battery/pages/BatteryCellsPage.tsx` | OK |
| `battery-degradation` | `BatteryDegradation` | `web/src/features/battery/pages/BatteryDegradationPage.tsx` | OK |
| `changelog` | `Changelog` | `web/src/features/system/pages/ChangelogPage.tsx` | OK |
| `charging` | `Charging` | `web/src/features/charging/pages/ChargingListPage.tsx` | OK |
| `charging-curve` | `ChargingCurve` | `web/src/features/charging/pages/ChargingCurvePage.tsx` | OK |
| `charging-heatmap` | `ChargingHeatmap` | `web/src/features/charging/pages/ChargingHeatmapPage.tsx` | OK |
| `charging/:id` | `ChargeDetail` | `web/src/features/charging/pages/ChargingDetailPage.tsx` | OK |
| `chatbot` | `Chatbot` | `web/src/features/system/pages/ChatbotPage.tsx` | OK |
| `climate-control` | `ClimateControl` | `web/src/features/vehicle-systems/pages/ClimateControlPage.tsx` | OK |
| `command-history` | `CommandHistory` | `web/src/features/system/pages/CommandHistoryPage.tsx` | OK |
| `commands` | `Commands` | `web/src/features/system/pages/CommandsPage.tsx` | OK |
| `compare` | `Navigate -> /period-compare` | `(redirect)` | OK |
| `cost-analysis` | `CostAnalysis` | `web/src/features/charging/pages/CostAnalysisPage.tsx` | OK |
| `data-export` | `DataExport` | `web/src/features/system/pages/DataExportPage.tsx` | OK |
| `data-repair` | `DataRepair` | `web/src/features/system/pages/DataRepairPage.tsx` | OK |
| `db-health` | `DBHealthDashboard` | `web/src/features/system/pages/DBHealthPage.tsx` | OK |
| `dev-tools` | `DevTools` | `web/src/features/admin/pages/DevToolsPage.tsx` | OK |
| `digital-twin` | `DigitalTwin` | `web/src/features/vehicles/pages/DigitalTwinPage.tsx` | OK |
| `drive-score` | `DriveScore` | `web/src/features/driving/pages/DriveScorePage.tsx` | OK |
| `drives` | `Drives` | `web/src/features/driving/pages/DrivesListPage.tsx` | OK |
| `drives/:id` | `DriveDetail` | `web/src/features/driving/pages/DriveDetailPage.tsx` | OK |
| `drives/:id/replay` | `TripReplay` | `web/src/features/trips/pages/TripReplayPage.tsx` | OK |
| `drivetrain-health` | `DrivetrainHealth` | `web/src/features/driving/pages/DrivetrainHealthPage.tsx` | OK |
| `driving-dynamics` | `DrivingDynamics` | `web/src/features/driving/pages/DrivingDynamicsPage.tsx` | OK |
| `efficiency` | `Efficiency` | `web/src/features/driving/pages/EfficiencyPage.tsx` | OK |
| `energy` | `Energy` | `web/src/features/battery/pages/EnergyPage.tsx` | OK |
| `energy-flow` | `EnergyFlow` | `web/src/features/battery/pages/EnergyFlowPage.tsx` | OK |
| `energy-products` | `EnergyProducts` | `web/src/features/battery/pages/EnergyProductsPage.tsx` | OK |
| `exports` | `ExportsPage` | `web/src/features/exports/pages/ExportsPage.tsx` | OK |
| `fleet-api` | `FleetAPI` | `web/src/features/admin/pages/FleetAPIPage.tsx` | OK |
| `geofences` | `Geofences` | `web/src/features/maps/pages/GeofencesPage.tsx` | OK |
| `glance` | `GlancePage` | `web/src/features/dashboard/pages/GlancePage.tsx` | OK |
| `guard-mode` | `GuardMode` | `web/src/features/vehicle-systems/pages/GuardModePage.tsx` | OK |
| `lifetime-stats` | `LifetimeStats` | `web/src/features/analytics/pages/LifetimeStatsPage.tsx` | OK |
| `live` | `LiveMap` | `web/src/features/maps/pages/MapOverviewPage.tsx` | OK |
| `live-monitor` | `LiveSignalMonitor` | `web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx` | OK |
| `locations` | `Locations` | `web/src/features/maps/pages/LocationsPage.tsx` | OK |
| `maintenance` | `Maintenance` | `web/src/features/vehicle-systems/pages/MaintenancePage.tsx` | OK |
| `me/activity` | `MyActivity` | `web/src/features/system/pages/MyActivityPage.tsx` | OK |
| `media-player` | `MediaPlayer` | `web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx` | OK |
| `mileage` | `Mileage` | `web/src/features/analytics/pages/MileagePage.tsx` | OK |
| `mqtt-inspector` | `MQTTInspector` | `web/src/features/telemetry/pages/MQTTInspectorPage.tsx` | OK |
| `navigation` | `NavigationRoute` | `web/src/features/maps/pages/NavigationRoutePage.tsx` | OK |
| `notifications` | `Notifications` | `web/src/features/notifications/pages/NotificationsPage.tsx` | OK |
| `onboarding` | `Onboarding` | `web/src/features/onboarding/pages/OnboardingPage.tsx` | OK |
| `period-compare` | `PeriodCompare` | `web/src/features/analytics/pages/PeriodComparePage.tsx` | OK |
| `power-flow` | `PowerFlowDashboard` | `web/src/features/battery/pages/PowerFlowDashboardPage.tsx` | OK |
| `powershare` | `Powershare` | `web/src/features/charging/pages/PowersharePage.tsx` | OK |
| `projected-range` | `ProjectedRange` | `web/src/features/battery/pages/ProjectedRangePage.tsx` | OK |
| `quick-stats` | `QuickStats` | `web/src/features/dashboard/pages/QuickStatsPage.tsx` | OK |
| `redis-signals` | `RedisSignalViewer` | `web/src/features/admin/pages/RedisSignalViewerPage.tsx` | OK |
| `regen-efficiency` | `RegenEfficiency` | `web/src/features/driving/pages/RegenEfficiencyPage.tsx` | OK |
| `roadmap` | `Roadmap` | `web/src/features/system/pages/RoadmapPage.tsx` | OK |
| `route-efficiency` | `RouteEfficiency` | `web/src/features/driving/pages/RouteEfficiencyPage.tsx` | OK |
| `s/:token` | `SharedDrive` | `web/src/features/sharing/pages/SharedDrivePage.tsx` | OK |
| `safety-settings` | `SafetySettings` | `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx` | OK |
| `search` | `Search` | `web/src/features/system/pages/SearchPage.tsx` | OK |
| `security-access` | `SecurityAccess` | `web/src/features/admin/pages/SecurityAccessPage.tsx` | OK |
| `settings` | `Settings` | `web/src/features/settings/pages/SettingsPage.tsx` | OK |
| `signal-diff` | `SignalDiff` | `web/src/features/telemetry/pages/SignalDiffPage.tsx` | OK |
| `signal-explorer` | `SignalExplorer` | `web/src/features/telemetry/pages/SignalExplorerPage.tsx` | OK |
| `signal-gaps` | `SignalGapDetector` | `web/src/features/telemetry/pages/SignalGapDetectorPage.tsx` | OK |
| `signal-log` | `SignalLogViewer` | `web/src/features/telemetry/pages/SignalLogViewerPage.tsx` | OK |
| `sleep-efficiency` | `SleepEfficiency` | `web/src/features/battery/pages/SleepEfficiencyPage.tsx` | OK |
| `smart-charge` | `SmartCharge` | `web/src/features/charging/pages/SmartChargePage.tsx` | OK |
| `software-updates` | `SoftwareUpdates` | `web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx` | OK |
| `speed-profile` | `SpeedProfile` | `web/src/features/driving/pages/SpeedProfilePage.tsx` | OK |
| `state-debugger` | `StateMachineDebugger` | `web/src/features/system/pages/StateMachineDebuggerPage.tsx` | OK |
| `statistics` | `Statistics` | `web/src/features/analytics/pages/StatisticsPage.tsx` | OK |
| `system-status` | `SystemStatus` | `web/src/features/system/pages/SystemStatusPage.tsx` | OK |
| `tco` | `TrueCostOwnership` | `web/src/features/analytics/pages/TrueCostPage.tsx` | OK |
| `temperature-impact` | `TemperatureImpact` | `web/src/features/maps/pages/TemperatureImpactPage.tsx` | OK |
| `tesla-account` | `TeslaAccount` | `web/src/features/system/pages/TeslaAccountPage.tsx` | OK |
| `tesla-charging-history` | `TeslaChargingHistory` | `web/src/features/charging/pages/TeslaChargingHistoryPage.tsx` | OK |
| `tesla-charging-sessions` | `TeslaChargingSessions` | `web/src/features/charging/pages/TeslaChargingSessionsPage.tsx` | OK |
| `timeline` | `Timeline` | `web/src/features/analytics/pages/TimelinePage.tsx` | OK |
| `tire-pressure` | `TirePressure` | `web/src/features/vehicle-systems/pages/TirePressurePage.tsx` | OK |
| `trip-planner` | `TripPlanner` | `web/src/features/driving/pages/TripPlannerPage.tsx` | OK |
| `trips` | `Trips` | `web/src/features/trips/pages/TripListPage.tsx` | OK |
| `trips/:id` | `TripDetail` | `web/src/features/trips/pages/TripDetailPage.tsx` | OK |
| `vampire-drain` | `VampireDrain` | `web/src/features/battery/pages/VampireDrainPage.tsx` | OK |
| `vehicle-comparison` | `FleetCompare` | `web/src/features/analytics/pages/FleetComparePage.tsx` | OK |
| `vehicles` | `Vehicles` | `web/src/features/vehicles/pages/VehicleListPage.tsx` | OK |
| `vehicles/:id` | `VehicleDetail` | `web/src/features/vehicles/pages/VehicleDetailPage.tsx` | OK |
| `vehicles/:id/access` | `VehicleAccess` | `web/src/features/vehicles/pages/VehicleAccessPage.tsx` | OK |
| `watch` | `WatchFace` | `web/src/features/watch/pages/WatchFacePage.tsx` | OK |
| `weekly-digest` | `WeeklyDigest` | `web/src/features/analytics/pages/WeeklyDigestPage.tsx` | OK |
| `year-review/:year` | `YearReview` | `web/src/features/analytics/pages/YearReviewPage.tsx` | OK |

## Layout wrapper

The `/` route renders `<Layout />` (eager import from
`./components/layout/Layout`), and all 102 inner routes nest under it
via `<Outlet />`. Layout is not lazy-loaded; it ships with the initial
chunk so the sidebar/header chrome paints during page navigation.

## Navigate redirects

The single `<Navigate>` redirect — `compare → /period-compare` — has
no module backing it. It exists for backward compatibility with old
links referencing the historical `/compare` URL.

## Catch-all routes

The `*` (NotFound) catch-all is registered twice on purpose:

1. **Inside `<Layout />`** so unknown URLs still render with the
   sidebar/header chrome instead of a blank `<Outlet />`.
2. **Outside `<Layout />`** as a defensive top-level fallback against
   any future top-level routes that forget to nest under `/`.

In normal operation the inner one wins.

## ADR-005 #1 — No deletions

This is an **audit-only** prompt. Per the Honesty Covenant rule 11 and
ADR-005 #1, the gate **never deletes routes** even if a row were marked
BROKEN — instead it would exit STATUS=BLOCKED for human triage. In this
run no routes are broken, so the gate exits STATUS=DONE.

## Predecessor note

Phase-43/0080 (hook coverage audit) is committed at HEAD `35ea25854`
with STATUS=BLOCKED — that is the **expected** audit-only outcome (9
hooks need human triage: 3 ORPHAN, 7 MISSING_ROUTE, 1 overlap; no
deletions performed). Route-coverage audit is orthogonal to the
hook-coverage findings (no shared remediation), so 0080 BLOCKED is
treated as an acceptable predecessor for 0081.
