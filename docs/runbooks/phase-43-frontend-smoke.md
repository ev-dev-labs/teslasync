# Phase-43 frontend smoke checklist

Run after deploying phase-42 (backend SI cutover) + phase-43 (frontend
port). Cover one vehicle in each unit-preference state (metric and
imperial) before signing off.

This is a **manual** checklist for the human deployer. The automated
gates (tsc, build, audit, route+hook coverage) catch compile-time and
structural breakage but cannot prove that, for example, the battery
dashboard displays the correct number of kWh after the SI conversion
pipeline change. Walk every check below for both unit-preference
profiles before signing off the release.

## How to use this checklist

1. Pick a healthy test vehicle that has been streaming Fleet Telemetry
   for at least 24 hours (so historical charts and aggregates are
   populated).
2. In the same browser session, complete the full pass with `Settings
   → General → Units = Metric` (km, °C, bar). Then toggle to
   `Imperial` (mi, °F, psi) and walk every "(M/I)" check again. Watch
   for 1.609x or 5/9 inflation/deflation — those are the classic
   missed-conversion symptoms (Phase-43 history: useDriveDetailData
   1609x bug, BatteryDegradationPage 1609x bug, TirePressurePage
   10000x bug).
3. Log every deviation in the incident channel with screenshot,
   browser dev-tools network tab payload, and the affected feature
   section name from this runbook.
4. Do **not** sign off if any "(M/I)" check fails in either unit mode
   — even if it passes the other one.

## Setup

- [ ] Phase-42 backend deployed and healthy (`/healthz`, `/readyz`
      both 200).
- [ ] Phase-43 frontend bundle deployed; build hash visible in
      `/system/version` matches the deploy artifact.
- [ ] Test vehicle paired and recently online (last ping < 5 min).
- [ ] Test vehicle has at least one completed drive in the last 7 days.
- [ ] Test vehicle has at least one completed charging session in the
      last 7 days.
- [ ] At least one geofence and one favourite location exist for the
      test vehicle (otherwise maps/locations panels render empty).
- [ ] Browser dev-tools network tab open in a second window — watch
      for any `/api/v1/...` request returning 4xx/5xx during the walk.
- [ ] No orphaned `/api/v1/api/v1/...` paths in network tab (would
      indicate a hook still double-prefixing — see prohibited pattern
      #7 in `.github/copilot-instructions.md`).

## Feature: vehicles

### VehicleListPage — `/vehicles`
- [ ] List shows every paired vehicle with display name, VIN suffix,
      model, year.
- [ ] (M/I) Odometer column shows km in metric mode and mi in
      imperial mode. Numbers MUST differ by ~1.609x — if identical,
      conversion has dropped.
- [ ] Online/offline pill renders correctly (green online, grey
      offline).
- [ ] Clicking a vehicle row routes to `/vehicles/{id}`.

### VehicleDetailPage — `/vehicles/{id}`
- [ ] Header shows correct VIN, model, year, exterior colour.
- [ ] (M/I) Battery range value uses km in metric and mi in imperial.
- [ ] (M/I) Outside temperature shows °C in metric and °F in
      imperial.
- [ ] No section is gated to invisibility on null data — every panel
      renders with EmptyState placeholder when data is missing.

### VehicleAccessPage — `/vehicles/{id}/sharing`
- [ ] Driver list shows the owner plus any invited drivers.
- [ ] "Invite driver" button opens the invitation modal.
- [ ] Pending invitations show created_at as a relative time string.
- [ ] Revoking a driver shows confirmation modal then refreshes the
      list.

### DigitalTwinPage — `/vehicles/{id}/digital-twin`
- [ ] 3D vehicle render loads (or graceful EmptyState if WebGL is
      unavailable).
- [ ] Door / frunk / trunk / window status badges match the actual
      vehicle state.
- [ ] (M/I) Tyre pressures render in bar (metric) or psi (imperial)
      with sensible decimals.

## Feature: charging

### ChargingListPage — `/charging`
- [ ] Recent sessions table shows start/end timestamps in browser
      timezone.
- [ ] (M/I) Energy (kWh) column is unit-pref-invariant (kWh always).
- [ ] Filter by date range narrows the list correctly.
- [ ] Clicking a session row routes to `/charging/{id}`.

### ChargingDetailPage — `/charging/{id}`
- [ ] Header shows session location address (geocoded) and start
      time.
- [ ] kWh delivered, peak kW, average kW match the source data.
- [ ] (M/I) Range added shows km in metric and mi in imperial.
- [ ] Telemetry chart renders battery_pct + charge_rate over time.

### ChargingCurvePage — `/charging/curve`
- [ ] Curve chart renders kW vs SoC% for the selected session.
- [ ] Charger type filter (DC/AC) updates the curve.
- [ ] Empty-state appears when no DC sessions exist.

### ChargingHeatmapPage — `/charging/heatmap`
- [ ] Heatmap shows day-of-week × hour-of-day with intensity gradient.
- [ ] Tooltip on hover shows session count and total kWh for that
      cell.

### CostAnalysisPage — `/charging/cost`
- [ ] Total cost panel matches user's currency symbol (Settings →
      Currency).
- [ ] Cost-per-kWh trend chart renders.
- [ ] Home vs supercharger breakdown sums to the totals row.

### SmartChargePage — `/charging/smart`
- [ ] Schedule rows show start time, end time, target SoC.
- [ ] Toggling a schedule on/off persists across page reload.
- [ ] Off-peak window picker accepts time-of-day input.

### PowersharePage — `/charging/powershare`
- [ ] Powershare status panel renders (enabled/disabled/unknown).
- [ ] Recent powershare events table loads.

### TeslaChargingHistoryPage — `/charging/tesla-history`
- [ ] Tesla-account-imported sessions show with Tesla source pill.
- [ ] Cost in Tesla account matches what is shown.

### TeslaChargingSessionsPage — `/charging/tesla-sessions`
- [ ] Imported sessions list renders with date, location, kWh.
- [ ] (M/I) Distance column (if present) honours unit pref.

### TeslaChargingSessionsMap — `/charging/tesla-sessions/map`
- [ ] Map loads with markers at each charging location.
- [ ] Clicking a marker shows session details popup.

## Feature: driving

### DrivesListPage — `/drives`
- [ ] Recent drives list with start/end times and route preview.
- [ ] (M/I) Distance column shows km in metric, mi in imperial.
- [ ] (M/I) Avg speed shows km/h in metric, mph in imperial.
- [ ] Pagination / load-more works.

### DriveDetailPage — `/drives/{id}`
- [ ] Header shows start/end addresses and duration.
- [ ] (M/I) Distance, max speed, avg speed, energy/distance use
      correct units.
- [ ] (M/I) Elevation gain/loss shows m in metric and ft in imperial.
- [ ] Telemetry chart shows speed, battery_pct, power over time.
- [ ] Map renders the polyline of the drive.

### TripReplayPage — `/drives/{id}/replay`
- [ ] Playback controls (play/pause/scrub) animate the marker on the
      map.
- [ ] Dynamic readouts (speed, SoC, range) update during playback.
- [ ] (M/I) Speed and range readouts honour the active unit pref.

### TripPlannerPage — `/driving/plan`
- [ ] Origin and destination inputs accept addresses and geocode them.
- [ ] (M/I) Estimated distance and duration render with correct units.
- [ ] Energy estimate accounts for vehicle range.

### SpeedProfilePage — `/driving/speed-profile`
- [ ] Histogram of time-spent-at-speed renders.
- [ ] (M/I) X-axis labels show km/h in metric, mph in imperial.

### RouteEfficiencyPage — `/driving/route-efficiency`
- [ ] Route efficiency table shows Wh/km (or Wh/mi) per route.
- [ ] (M/I) Efficiency unit suffix toggles with unit pref.

### RegenEfficiencyPage — `/driving/regen-efficiency`
- [ ] Regen recovery % per drive renders.
- [ ] kWh recovered chart renders over the time-window selector.

### EfficiencyPage — `/driving/efficiency`
- [ ] (M/I) Lifetime Wh/km vs Wh/mi displayed correctly.
- [ ] Trailing 30-day efficiency trend renders.

### DrivingDynamicsPage — `/driving/dynamics`
- [ ] G-force panel renders (lateral, longitudinal scatter).
- [ ] Pedal usage histogram renders.
- [ ] Autopilot engagement timeline renders.

### DrivetrainHealthPage — `/driving/drivetrain-health`
- [ ] Front and rear motor torque / temp panels render.
- [ ] Inverter telemetry rows present.

### DriveScorePage — `/driving/score`
- [ ] Latest drive score card shows numeric score 0-100.
- [ ] Score breakdown sub-metrics (smoothness, efficiency, regen)
      render.

## Feature: battery

### BatteryHealthPage — `/battery/health`
- [ ] (M/I) Rated range card uses km in metric and mi in imperial.
- [ ] Capacity-remaining radial gauge renders with current %.
- [ ] Cycle-count tile renders a sane integer.
- [ ] Long-term capacity trend chart renders ≥ 7 data points.

### BatteryDegradationPage — `/battery/degradation`
- [ ] (M/I) Y-axis "rated range" series uses correct unit (no 1609x
      inflation — Phase-43/0023 fix in effect).
- [ ] Degradation % over time line renders.
- [ ] Comparison vs fleet median band renders.

### BatteryCellsPage — `/battery/cells`
- [ ] Cell-voltage min/max/spread tiles render.
- [ ] Per-brick voltage chart renders.
- [ ] Brick-imbalance warning shown if spread > threshold.

### EnergyPage — `/energy`
- [ ] (M/I) Lifetime kWh used and Wh/distance render.
- [ ] Source split (drive vs charge vs vampire) sums to total.

### EnergyFlowPage — `/energy/flow`
- [ ] Live power-flow diagram renders direction (battery↔motors,
      battery↔charger, solar→battery if applicable).
- [ ] Numeric kW values match `/system/health` live signals.

### EnergyProductsPage — `/energy/products`
- [ ] If user has a Powerwall / solar product, panel renders status.
- [ ] If no product, EmptyState message shown — never a blank panel.

### PowerFlowDashboardPage — `/energy/power-flow-dashboard`
- [ ] Aggregate live kW chart renders for last 60 min.
- [ ] Each lane (PV, grid, home, battery) sums to net.

### ProjectedRangePage — `/battery/projected-range`
- [ ] (M/I) Projected range under typical-conditions tile uses correct
      unit.
- [ ] Effect-of-temperature chart renders.

### SleepEfficiencyPage — `/battery/sleep`
- [ ] Sleep-state timeline renders for last 7 days.
- [ ] kWh-lost-while-parked chart renders.

### VampireDrainPage — `/battery/vampire`
- [ ] Vampire drain rate (kWh/day) tile renders.
- [ ] Trend chart spans last 30 days.

## Feature: telemetry

### SignalExplorerPage — `/telemetry/signals`
- [ ] Signal catalogue dropdown lists ≥ 20 signals.
- [ ] Selecting a signal renders its history chart.
- [ ] Chart x-axis shows correct time range and timezone.
- [ ] Raw value column on the right shows the signal name's native
      unit (no SI conversion at this generic viewer — by design).

### SignalLogViewerPage — `/telemetry/log`
- [ ] Recent signal_log rows table renders newest-first.
- [ ] Filter by signal name narrows rows.
- [ ] value_num / value_str / value_bool columns populate as
      appropriate.

### LiveSignalMonitorPage — `/telemetry/live`
- [ ] At least one signal updates within 30 s of opening the page (SSE
      or poll).
- [ ] Subscribe / unsubscribe to a signal works without console errors.

### MQTTInspectorPage — `/telemetry/mqtt`
- [ ] Recent MQTT messages stream into the view.
- [ ] Topic filter narrows the stream.

### SignalGapDetectorPage — `/telemetry/gaps`
- [ ] Gap-detection table lists signals with > 2 min silence.
- [ ] Time-since-last-value column updates on refresh.

### SignalDiffPage — `/telemetry/diff`
- [ ] Diff between two snapshots renders changed-keys list.
- [ ] Empty result when snapshots are identical.

## Feature: analytics

### AnalyticsPage — `/analytics`
- [ ] Top-level KPIs (total drives, total kWh, total cost) render
      with sensible numbers.
- [ ] (M/I) Total distance KPI honours unit pref.

### LifetimeStatsPage — `/analytics/lifetime`
- [ ] Lifetime drives / kWh / cost / distance tiles render.
- [ ] (M/I) Distance and avg-distance-per-drive use correct unit.

### MileagePage — `/analytics/mileage`
- [ ] (M/I) Monthly mileage bar chart Y-axis labelled correctly.
- [ ] Year-over-year comparison line renders.

### StatisticsPage — `/analytics/statistics`
- [ ] State-summary table (driving / charging / sleeping / asleep)
      sums to ~100% of period.
- [ ] (M/I) All distance / speed columns use unit pref.

### TimelinePage — `/analytics/timeline`
- [ ] Timeline strip shows drive (blue) / charge (green) / sleep
      (grey) blocks across last 7 days.
- [ ] Hover tooltip shows event details.

### PeriodComparePage — `/analytics/period-compare`
- [ ] Two date-range pickers update the comparison.
- [ ] (M/I) Distance/efficiency/cost deltas render with % change
      regardless of unit pref (% is unit-invariant).

### FleetComparePage — `/analytics/fleet-compare`
- [ ] If user has > 1 vehicle, fleet comparison table renders one
      row per vehicle.
- [ ] (M/I) Wh/km vs Wh/mi efficiency column toggles correctly.

### TrueCostPage — `/analytics/tco`
- [ ] Per-mile / per-km cost tile uses currency symbol from settings.
- [ ] (M/I) Cost-per-distance unit toggles.
- [ ] Breakdown (electricity, depreciation, insurance) sums to total.

### WeeklyDigestPage — `/analytics/weekly-digest`
- [ ] Weekly digest card renders with last full week's metrics.
- [ ] Email-preview button (if present) renders the email body.

### YearReviewPage — `/analytics/year-review`
- [ ] Slide deck of yearly milestones renders.
- [ ] (M/I) "X km/drive average" tile uses correct unit.

## Feature: trips

### TripListPage — `/trips`
- [ ] Trip list renders with date, name, distance.
- [ ] (M/I) Distance column uses correct unit.
- [ ] (M/I) Energy efficiency column uses Wh/km or Wh/mi.

### TripDetailPage — `/trips/{id}`
- [ ] Trip detail shows constituent drives + charges.
- [ ] (M/I) Total distance and avg speed honour unit pref.
- [ ] Map of trip route renders polyline.

### TripReplayPage — `/trips/{id}/replay`
- [ ] Playback controls work and animate the marker.
- [ ] (M/I) Cumulative distance ticker uses correct unit (Phase-43
      /0026 fix in effect).

## Feature: maps

### MapOverviewPage — `/maps`
- [ ] Map renders centred on current vehicle position.
- [ ] (M/I) Speed and range panels use correct unit.
- [ ] Recent positions trail renders behind the marker.

### NavigationRoutePage — `/maps/navigation`
- [ ] Active navigation route renders if vehicle is navigating.
- [ ] (M/I) "Distance to arrival" panel uses correct unit (Phase-43
      /0027 fix in effect — meters→display).

### TemperatureImpactPage — `/maps/temperature-impact`
- [ ] Map heatmap shows efficiency × ambient-temperature.
- [ ] (M/I) Wh/distance tooltip uses Wh/km in metric, Wh/mi in
      imperial.
- [ ] (M/I) Temperature axis shows °C in metric, °F in imperial.

### LocationsPage — `/locations`
- [ ] Saved favourite locations list renders.
- [ ] Visit count and total duration columns render.
- [ ] Add / edit / delete location modal works.

### GeofencesPage — `/locations/geofences`
- [ ] Geofences list renders with name + radius (m).
- [ ] Toggling a geofence on/off persists.
- [ ] Map preview shows the geofence circle.

## Feature: dashboard

### DashboardPage — `/`
- [ ] Customised dashboard layout loads (uses last-saved layout).
- [ ] Each widget loads either real data or a graceful EmptyState.
- [ ] Drag/drop in edit mode reorders widgets.
- [ ] Save layout persists across reload.

### GlancePage — `/glance`
- [ ] Glance view shows the at-a-glance vehicle status panel.
- [ ] (M/I) Range tile uses correct unit.
- [ ] (M/I) Outside temp tile uses correct unit.

### QuickStatsPage — `/quick-stats`
- [ ] Quick-stats grid renders ≥ 6 stat cards.
- [ ] Numbers update without console errors.

## Feature: system

### SystemStatusPage — `/system/status`
- [ ] System health panel shows green for all subsystems
      (api / db / mqtt / redis / fleet-telemetry).
- [ ] Recent errors panel renders last 50 errors.

### DBHealthPage — `/system/db-health`
- [ ] DB connection-pool stats panel renders.
- [ ] Hypertable size table renders rows.

### DataExportPage — `/system/export`
- [ ] Export form accepts date range + format.
- [ ] Submitting export creates a job that appears in jobs list.

### CommandsPage — `/system/commands`
- [ ] Available commands grid renders for the selected vehicle.
- [ ] Sending a no-op command (e.g. honk) returns success toast.

### CommandHistoryPage — `/system/commands/history`
- [ ] Command-history table shows recent commands with status.
- [ ] Failed commands show error message in expand-row.

### ChatbotPage — `/chatbot`
- [ ] Chatbot panel loads.
- [ ] Sending a test prompt returns a response.

### ChangelogPage — `/changelog`
- [ ] Changelog renders most-recent release at top.

### ScheduledExportsPanel — `/system/scheduled-exports`
- [ ] Scheduled exports list renders.
- [ ] Adding / removing a schedule persists.

### RoadmapPage — `/roadmap`
- [ ] Roadmap milestones render in chronological order.

### NotFoundPage — `/anything-bogus`
- [ ] 404 page renders with link back to dashboard.

### MyActivityPage — `/my-activity`
- [ ] Activity timeline renders user actions over last N days.

### StateMachineDebuggerPage — `/system/fsm-debugger`
- [ ] FSM state diagram renders for the selected vehicle.
- [ ] Recent transitions table renders.

### SearchPage — `/search`
- [ ] Search input accepts a query and returns hits across types.
- [ ] Each hit row links to its target page.

### TeslaAccountPage — `/system/tesla-account`
- [ ] Tesla OAuth status panel shows connected / disconnected.
- [ ] Re-pair button triggers OAuth flow.

### DataRepairPage — `/system/data-repair`
- [ ] Drive-edit form loads selected drive.
- [ ] Submitting an edit (distance_m, max_speed_mps, end_battery_pct)
      persists and the drive list reflects the change (Phase-43/0029
      silent-drop fix in effect).

### DiagnosticPage — `/system/diagnostic`
- [ ] Diagnostic panel renders backend probe results.

## Feature: vehicle-systems

### TirePressurePage — `/vehicle-systems/tire-pressure`
- [ ] (M/I) All four tyre-pressure gauges show ~2.2 bar (metric) or
      ~32 psi (imperial). Numbers MUST NOT be 22000+ (10000x bug
      from Phase-43/0030 must remain fixed).
- [ ] Low-pressure warning chip lights when below threshold.

### ClimateControlPage — `/vehicle-systems/climate`
- [ ] (M/I) Inside-temp and outside-temp tiles use °C in metric and
      °F in imperial — no double "°°" symbol.
- [ ] Climate on/off toggle dispatches a command without console
      errors.
- [ ] Set-temperature slider works.

### SafetySettingsPage — `/vehicle-systems/safety`
- [ ] (M/I) "Distance since reset" and "Self-driving distance" tiles
      use km in metric and mi in imperial (Phase-43/0030 fix in
      effect).
- [ ] Safety-feature toggles render checked/unchecked correctly.

### MediaPlayerPage — `/vehicle-systems/media`
- [ ] Now-playing card renders title, artist, album.
- [ ] Volume / position bars render.

### MaintenancePage — `/vehicle-systems/maintenance`
- [ ] Service-due list renders next-due items.
- [ ] **KNOWN ISSUE (deferred)**: due-mileage may be miscalculated
      because backend mixes Phase-42 metres with hardcoded mile
      intervals. Verify renders without crashing; do **not** trust
      numeric values until backend prompt lands.

### GuardModePage — `/vehicle-systems/guard`
- [ ] Guard mode status panel renders.
- [ ] **KNOWN ISSUE (deferred)**: guard endpoints deleted by Phase-42
      /0077; page may show EmptyState. Verify it does not crash.

### SoftwareUpdatesPage — `/vehicle-systems/software`
- [ ] Current firmware version tile renders.
- [ ] Update history list renders.

## Feature: automations

### AutomationsListPage — `/automations`
- [ ] Automations list renders with name, status, last-run.
- [ ] Toggling an automation on/off persists.
- [ ] Filter by status (active/disabled/error) narrows the list.

### AutomationListPage — `/automations/list`
- [ ] Alternative list view renders the same data set.

### AutomationBuilderPage — `/automations/new`
- [ ] Trigger / condition / action sections render and accept input.
- [ ] Save creates a new automation visible in the list.

### AutomationCard — within `/automations`
- [ ] Each card shows execution_count, failure_count gracefully (may
      render `—` when undefined per locked-policy).

### AutomationActivityFeed — within `/automations`
- [ ] Recent activity feed renders most-recent run at top.

### TriggerConfigurator — within builder
- [ ] Cron / signal-threshold / geofence trigger pickers render.
- [ ] Selected values persist on switching tabs.

### ConditionBuilder — within builder
- [ ] Condition rows accept signal name + operator + value.
- [ ] Add / remove condition row works.

### ActionBuilder — within builder
- [ ] Vehicle command / notification / setting actions selectable.
- [ ] Action params form renders for the chosen action type.

### ConflictWarnings — within builder
- [ ] Conflicting-rule warning banner renders when overlap detected.

### PresetGallery — `/automations/presets`
- [ ] Preset cards render with name + description.
- [ ] "Use preset" button creates a new automation pre-filled.

## Feature: notifications

### NotificationsPage — `/notifications`
- [ ] Inbox shows recent notifications with severity pill.
- [ ] Mark-read / mark-unread / archive actions persist.
- [ ] Filter by vehicle / severity / read-state narrows the list.

### AlertsPage — `/alerts`
- [ ] Alerts list renders with severity, title, timestamp,
      acknowledged state.
- [ ] Acknowledge button persists and reloads the row.
- [ ] Filtering by date range narrows the list.

### AlertRulesPage — `/alerts/rules`
- [ ] Rules list renders with rule name, condition summary,
      last-triggered.
- [ ] Toggling a rule on/off persists.
- [ ] Snoozing a rule persists with snooze-until timestamp.

### AlertStudioPage — `/alerts/studio`
- [ ] Rule builder renders trigger / condition / action sections.
- [ ] Computed-metric preview returns a numeric result for a valid
      formula.
- [ ] Test-fire button sends a test notification.

## Feature: admin

### AdminPage — `/admin`
- [ ] Admin home panel renders with quick links.
- [ ] Re-auth button works.

### UsersPage — `/admin/users`
- [ ] Users table renders with username, email, role.
- [ ] Role-change dropdown persists.

### SystemPage — `/admin/system`
- [ ] System config table renders key/value rows.
- [ ] Editing a config value persists.

### SecurityAccessPage — `/admin/security`
- [ ] Security events list renders for selected vehicle.

### RedisSignalViewerPage — `/admin/redis-signals`
- [ ] Live Redis hash for `vehicle:{id}:signals` renders.
- [ ] Categorisation regex groups signals by domain.

### RbacMatrixPage — `/admin/rbac`
- [ ] Role × permission matrix renders.
- [ ] Toggling a cell persists.

### LiveLogsPage — `/admin/logs`
- [ ] Live log stream prints lines as they occur.
- [ ] Pause / resume button stops/starts the stream.

### FleetAPIPage — `/admin/fleet-api`
- [ ] Fleet API endpoint coverage table renders.
- [ ] Last-call timestamps populate.

### FeedbackQueuePage — `/admin/feedback`
- [ ] Feedback submissions list renders.
- [ ] Mark-resolved persists.

### DevToolsPage — `/admin/dev-tools`
- [ ] DB-stats / migration-status / runtime-info panels render.

### BackupRestorePage — `/admin/backup`
- [ ] Backup configs list renders.
- [ ] Recent backup runs list renders with status.
- [ ] Trigger-backup button kicks a job that appears in the runs
      list.

### ApiPlaygroundPage — `/admin/api-playground`
- [ ] Endpoint dropdown lists available routes.
- [ ] Send button returns a response.

### ApiLogsPage — `/admin/api-logs`
- [ ] API call log table renders newest-first.
- [ ] Filter by status code / endpoint narrows the list.

### APIKeysPage — `/admin/api-keys`
- [ ] API keys list renders with prefix + created_at.
- [ ] Create-key flow returns a one-time-shown secret.
- [ ] Revoke-key persists.

## Feature: settings

### SettingsPage — `/settings`
- [ ] All 18 sections (Tesla account, region, features, general, gas
      price, notifications, quiet hours, appearance, advanced, search,
      TOTP, export/import, webhook channels, active sessions, reset,
      privacy, settings field, polling) render.
- [ ] (M/I) Toggling `Units → length` between km and mi persists and
      visibly toggles every other page on the next pass.
- [ ] (M/I) Toggling `Units → temperature` between °C and °F
      persists.
- [ ] (M/I) Toggling `Units → pressure` between bar and psi persists.
- [ ] Saving a notification quiet-hours window persists.
- [ ] Saving a webhook channel URL persists.
- [ ] Active-sessions panel lists current browser session.

## Feature: sharing

### SharedDrivePage — `/share/{token}` (anonymous, no auth)
- [ ] Page loads in incognito browser without a session.
- [ ] (M/I) Distance, max speed, avg speed render — anonymous viewers
      get default unit (km/h, m elevation) per design.
- [ ] If logged in as authenticated viewer in another tab, unit-pref
      is applied instead of defaults.
- [ ] Map polyline renders.
- [ ] Elevation chart renders with correct unit suffix.

## Feature: onboarding

### OnboardingPage — `/onboarding`
- [ ] Stepper shows 3 steps: Tesla connected, vehicle count, data
      flowing.
- [ ] Each step badge updates from pending → in-progress → complete
      as the conditions are met.
- [ ] Tour launcher button starts the guided tour overlay.
- [ ] On `is_complete=true`, redirect to `/` happens within one
      polling cycle.

## Feature: watch

### WatchFacePage — `/watch` (Apple Watch / Wear OS face)
- [ ] Page loads in a 240×240 viewport without horizontal scroll.
- [ ] (M/I) Range tile uses km in metric and mi in imperial.
- [ ] (M/I) Inside-temp tile uses bare ° suffix (the wearable face
      intentionally omits the C/F letter).
- [ ] Battery-percent ring renders.
- [ ] Watch complication endpoint returns 200 and JSON shape matches
      `WatchComplication` interface.

## Feature: diagnostics

### AnomalyDashboardPage — `/diagnostics/anomalies`
- [ ] Anomaly list renders with signal name, severity, z-score,
      detected_at.
- [ ] Severity filter (critical / warning / info) narrows the list.
- [ ] Health-summary tiles (battery / tyres / motors / hvac /
      charging) render with ok / warning / critical state.
- [ ] Signal-frequency bar chart renders.
- [ ] **By design**: z-scores, baselines, value columns are unitless
      statistical observations — do **not** expect SI conversion.
      Same a.value field carries different physical units depending
      on the a.signal name (BatteryLevel%, TpmsPressure Pa,
      RatedRange m).

## Sign-off

- [ ] Reviewer name: ____________________________________
- [ ] Reviewer date: ____________________________________
- [ ] Backend release tag: ______________________________
- [ ] Frontend release tag: _____________________________
- [ ] Test vehicle VIN suffix: __________________________
- [ ] Browser + version: ________________________________
- [ ] Metric-mode pass: ☐ pass / ☐ fail (incidents: __________)
- [ ] Imperial-mode pass: ☐ pass / ☐ fail (incidents: ________)
- [ ] Any deviations from expected display logged in incident
      channel: ☐ N/A / ☐ logged with link: __________________

Sign off only when **both** unit-mode passes are green. A single
"(M/I)" failure in either mode blocks the release because it likely
indicates a missed SI-conversion call site that will mis-display for
half of the user base.

## References

- ADR-004 (`.github/ARCHITECTURE.md`) — Phase-42 SI cutover decisions.
- ADR-005 (`.github/ARCHITECTURE.md`) — Phase-43 wire-shape and
  type-source decisions.
- `.github/copilot-instructions.md` — prohibited patterns #7 (no
  `/api/v1` double prefix) and #8 (snake_case query params).
- `.github/instructions/unit-conversion.instructions.md` — SI
  boundary rules (`@/lib/unitConversion`).
- `docs/runbooks/phase-43-hook-coverage.md` — hook → route audit.
- `docs/runbooks/phase-43-route-coverage.md` — App.tsx route audit.
- `docs/runbooks/phase-43-i18n-coverage.md` — i18n key coverage.

