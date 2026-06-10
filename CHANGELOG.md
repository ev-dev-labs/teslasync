# Changelog

All notable changes to TeslaSync are documented here.

## [Unreleased] — System Status polish + /admin removal

System Status (`/system-status`) is now the single operator-facing
console. The legacy `/admin` page (almost entirely duplicated by
`/system-status` plus existing dedicated pages) has been removed, with
its two unique pieces relocated.

Frontend changes:

- **`/admin` page removed.** The route now redirects to `/system-status`.
  The "Admin" sidebar entry, the `m` keyboard shortcut, and the
  prefetch/registry entries that pointed at it are all gone.
- **Frontend Errors panel** — now lives inside the *Recent errors*
  accordion on `/system-status` as `FrontendErrorsCard` (last-hour
  summary + top offenders, same `useWebErrorsSummary()` data source).
- **Audit Log** — promoted to its own dedicated page at
  `/notifications/audit` with search + filter chips + paginated table.
  A new sidebar entry under Notifications links to it.
- **HealthRow alignment** fix — labels were rendering centred when the
  row was clickable (browsers default `<button>` to `text-align:center`).
  Forced `text-left` on the row base + label span.
- **System Status spacing**: title now shares the body column
  (`max-w-5xl mx-auto` on `PageContainer`); StatusHero padding/icon/
  heading sizes tightened; sticky chip pills tightened.
- **Background workers card** — dropped the now-dead "Open Admin"
  footer link (the workers accordion on `/system-status` is the
  management surface).
- **Maintenance ActionItem** CTA repointed to
  `/system-status#maintenance` (operator can edit inline via the
  ScheduledMaintenanceCard already on the page).

Deleted files:

- `web/src/features/admin/pages/AdminPage.tsx`
- `web/src/features/admin/components/MaintenanceModePanel.tsx`

## [Unreleased] - Phase-48 SI canonical

Phase-48 completes the forward-only SI canonical mega-PR: production APIs,
exports, share payloads, frontend types, and documentation now use the new SI
field names only. Methodology:
`.github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md`.

Slice commits:
- `f916031b4` — Slice 1: Drive aggregates renamed to SI canonical.
- `f729a6a8` — Slice 2: Charging aggregates and telemetry renamed to SI canonical.
- `3371a493a` — Slice 3: Battery, energy, range, and mileage DTOs renamed.
- `6dc10602` — Slice 4: Trips, share payloads, import/export surfaces renamed.
- `6b19fd618` — Slice 5: Frontend legacy unit converters deleted.
- Slice 6 — Final hexagonal trip/dashboard cleanup, OpenAPI sweep, and docs.

Breaking changes:
- **CSV exports** — v2 filenames/columns are SI-only (for example
  `distance_m`, `duration_s`, `max_speed_mps`, `energy_used_wh`,
  `regen_energy_wh`). Update import scripts and dashboards that parse old CSV
  headers.
- **Share links** — share payloads use the v2 SI schema (`distance_m`,
  `duration_s`, `max_speed_mps`) and no longer publish legacy display-unit
  fields.
- **API fields** — legacy names such as `distance_mi`, `duration_min`,
  `energy_used_kwh`, `max_speed_mph`, `total_miles`, and `regen_kwh` were
  renamed to SI equivalents (`distance_m`, `duration_s`, `energy_used_wh`,
  `max_speed_mps`, `total_m`, `regen_energy_wh`).

Migration guide for external consumers:
1. Regenerate clients from `docs/public/openapi.yaml`.
2. Rename request/response field reads to the SI names above.
3. Treat energy values as Wh, distance as m, speed as m/s, power as W, and
   durations as s; apply display-unit conversion only at presentation time.
4. Update CSV parsers to accept the v2 filenames and headers.
5. Re-issue share links if downstream tooling requires v2-only payloads.

### 🚀 New Features

#### System Status — Phase 2 (operator-grade enhancements)
- **Tesla auth dedicated card** — Promotes account auth from a single health row to a fuller card with token-expiry countdown (healthy / expiring within 7 days / expired / disconnected) and a primary "Re-authenticate" CTA
- **Inline anomaly row** — New `<AnomalyInlineRow>` surfaces the most recent anomaly detected for the primary vehicle as a Health row (links to `/anomaly-detection`); renders nothing when there are no anomalies in the last 24h
- **Update-available callout** — Prominent in-page callout above the chip bar when `/system/update-check` reports a new release; links to `/changelog` (distinct from the global `<NewVersionBanner>` for client bundle reloads)
- **Run quick backup** — New "Run quick backup now" button inside the Backups accordion (mutation via `POST /backup/quick`); disables-while-pending, surfaces success/failure via toasts, and invalidates `backup-runs` queries on settle
- **Refresh button optimistic state** — Refresh action shows a spinning icon and is disabled while `isFetching` is true; the hero CTA mirrors the same loading state
- **Skeleton loaders** — Replaced the generic `loading` spinner with a layout-shaped `<StatusPageSkeleton>` that mirrors the page rhythm (hero → chips → 6 health rows → action items → resources → 4 accordions) so there is no layout shift on first load
- **Health staleness indicator** — Hero subline shows "(stale)" when `/system/health` errors or hasn't refreshed in over 2 minutes, and the hero status downgrades to `unknown` so operators don't trust stale data
- **Print stylesheet** — `@media print` rules drop the frosted-glass background, hide interactive scaffolding (refresh button, sticky compact hero, chip bar), and render a clean dark-on-white snapshot suitable for reports
- **Scroll-margin-top on sections** — Chip-bar nav now lands cleanly below sticky elements (`scroll-mt-24` applied to all `<section>` elements)
- **`tesla-auth` chip** — Added to the chip bar between Telemetry and Notifications
- **Tesla API usage enriched card** — Replaces the bare 6-row spend list with an operator-focused detail card: budget-progress bar, billing-window countdown ("Day 15 of 31 · resets in 16 days"), three at-a-glance bands (this month / last 24 h / forecast EOM), per-day burn rate, top services, by-method split, average latency, error-rate severity (amber ≥ 1 %, red ≥ 5 %), useful-vs-skipped poll breakdown, and a clear over-budget call-out — all without backend changes (combines `/system/api-usage` with `/api-logs/stats`)
- **Telemetry pipeline enriched card** — Replaces the bare 5-row fleet rollup with a per-vehicle telemetry liveness list so operators can immediately see which vehicle is sending data and which isn't. Shows fleet rollup (vehicles · positions · drives · charges · signals), liveness summary chips ("2 sending · 1 stale"), and per-vehicle rows with status pip (green < 5 min / amber 5–30 min / red > 30 min / grey offline), display name + VIN tail + state, battery progress bar, last-poll relative time, next-poll countdown, and a "polling engine disabled" warning when `/polling/status` reports `enabled: false`. Pulls already-loaded `useVehicles()` data and `/polling/status` (per-VIN engine state) — no backend changes
- **Background workers enriched card** — Replaces the bare worker rollup with an instance-aware view so operators running multiple replicas can immediately tell which instance is healthy and which isn't. Groups rows by worker `name`, shows per-instance host (e.g. `nw-1:8081`), latency, status chip, and inline error message when a probe fails. Top-line shows two-axis count ("2 of 3 types healthy · 4 of 6 instances healthy") plus a "Replicated" indicator. When no group has multiple instances yet, a callout explains how to enable horizontal scaling via `NOTIFICATION_WORKER_HOSTS` / `EXPORT_WORKER_HOSTS` / `AUTOMATION_WORKER_HOSTS` (comma-separated). Backend `WorkersHealthHandler` extended to honour the plural `*_HOSTS` env vars (and a comma-separated value in the singular `*_HOST` for forward compatibility); each replica is probed independently and emitted as its own row sharing the worker name. Backward-compatible: single-host deployments behave exactly as before
- **Diagnostics section removed** — The legacy `<DiagnosticsSection>` (API usage gauge + bar chart + worker health card grid) duplicated content already shown by the new `<TeslaApiUsageCard>` (Tesla API accordion) and `<BackgroundWorkersCard>` (Workers accordion). Deleted the section, the chip-bar entry, and the unused component file. The deeper API-spend visualisation (radial budget gauge, requests-vs-skipped bar) lives on the dedicated API logs and dev-tools pages

#### System Status — Phase 2 follow-up (previously deferred items now shipped)
- **Public Status API v1** — New `/api/v1/status/*` route group exposes a stable JSON contract for operator integrations (Grafana, Uptime Kuma, Home Assistant, etc.):
  - `GET /api/v1/status` — full snapshot (status, components, resources, maintenance, active incidents, counts)
  - `GET /api/v1/status/components` — health components only
  - `GET /api/v1/status/resources` — runtime memory / goroutines / DB pool / uptime
  - `GET /api/v1/status/uptime?window=24h|7d|30d|90d|1y` — % uptime per window with `historical_source` disclosure
  - `GET /api/v1/status/incidents?active=true` — list (with `count` envelope)
  - `GET /api/v1/status/live` — Server-Sent Events stream pushing `event: status` snapshots every 30 s plus `event: heartbeat` keepalives every 25 s
  - Reads rate-limited at 120 req/min; writes (incidents) at 30–60 req/min; SSE unrate-limited
- **Status API docs page** — New `/docs/status-api` static reference describes every endpoint, payload schema, status enum, severity enum, and a worked SSE consumer example
- **SSE live-status pill** — Replaces 30 s polling with a server push consumer (`useStatusLiveSSE` hook with exponential backoff 1 s → 30 s cap, visibility-aware resume); a `<LiveStatusPill>` in the page actions slot shows 🟢 Live / 🟡 Reconnecting / ⚪ Offline plus a relative "updated 12 s ago" timestamp; manual `Reconnect` button forces a re-attempt
- **Incident lifecycle (manual logging)** — New `status_incidents` table (migration 000198) with full CRUD via `/api/v1/status/incidents`:
  - States: investigating → identified → monitoring → resolved
  - Severity: minor / major / critical
  - Inline `updates` JSONB array (timestamp · status snapshot · message · author) so timelines render in a single query
  - `auto_dedupe_key` UNIQUE column reserved for future health-monitor auto-detection
  - HTTP author resolution from `X-Forwarded-User` / `Remote-User` headers, falls back to `"operator"`
- **`<IncidentsCard>`** — Slot above the chip bar, renders nothing when no active incidents, otherwise lists each with severity badge, status chip, started-at relative time, top-most update message preview, and a "Log incident" CTA opening `<IncidentForm>` (manual creation modal: title / severity / status / affected components / initial message)
- **`<IncidentTimelinePage>`** — Permalink page at `/system-status/incidents/:id` showing full lifecycle timeline, append-update form (with optional status change), resolve action with `<ConfirmDialog>`, and back-link to status page
- **`<ScheduledMaintenanceCard>`** — Operator-initiated maintenance windows via existing `/admin/system-mode` endpoint; supports `until` schedule, custom message, "Activate now" toggle, "Schedule update", and "Clear maintenance" actions; renders 24 h pre-banner ("Maintenance scheduled in 18 h") that bumps to amber when within the window
- **`<SubscribeCard>`** — Discoverability tile linking to existing notification channels (`/settings/notifications` for email / push / Discord / Slack / webhook); intentionally a pure router rather than duplicating the channel CRUD
- **`<SLOTrackingCard>`** — Multi-window uptime % visualisation (24 h / 7 d / 30 d / 90 d / 1 y) with personal target line (default 99 %, persisted in `localStorage` as `teslasync.status.slo.target`); calls `/api/v1/status/uptime?window=...` and surfaces healthy-vs-total component count alongside the percentage; tone toggles green/amber/red against the operator's own target
- **R-key keyboard shortcut** — Pressing `R` (when not in an input/textarea) refreshes the page; documented in actions slot tooltip; safe-by-default — no other shortcuts wired to avoid collision risk


#### Materialized Views & Fast Analytics
- **3 materialized views** — `mv_energy_daily`, `mv_position_hourly`, `mv_signal_stats` for sub-second dashboard and analytics queries
- Maintenance worker automatically refreshes materialized views on schedule

#### Battery Health Generator
- Daily automated battery snapshot generation from charging telemetry in maintenance worker
- Historical backfill migration (000057) to generate battery health data from existing charging sessions

#### Alert Studio Enhancements
- **Search filter** — Search rules by name in Alert Studio rules list
- **Inline delete** — Delete button with confirmation dialog on each rule row
- **Alerts pagination** — Client-side pagination (20 per page) on alerts list page

#### Zero-Value Data Filtering
- Position (0,0) filtering on insert and all query methods + cleanup migration (000056)
- All-zero tire pressure filtering on insert and query

#### FSM Debugger Improvements
- Added `since` field showing how long the vehicle has been in its current state
- Sub-FSM panel now matches actual DB `fsm_type` values (drives/charging)

#### Location Snapshot Backfill
- Navigation page backfills `current_lat`/`current_lon` from SignalStore cache when snapshot columns are null

### 🐛 Bug Fixes
- **Trip Replay** — Fixed NaN:NaN duration and missing stats by normalizing snake_case → camelCase field names
- **Live Map** — Switched from `location-snapshots` API to `positions` API (was showing all-dashes for LAT/LON due to null coordinates)
- **Navigation page** — Added missing `current_lat`, `current_lon`, `route_last_updated` columns to location snapshot SELECT query
- **Snapshot repo audit** — Fixed 8 missing columns across tire_pressure (6), media (1), vehicle_config (1) INSERT/SELECT queries
- **Dashboard charger power** — Formatted with `fmtNumber` (was showing raw float64 values)
- **Tire pressure page** — Replaced raw i18n keys with friendly labels, moved unit indicator to column headers
- **Decimal precision** — Enforced global precision setting across all numeric displays
- **Pressure unit setting** — Added bar/psi display-only conversion for tire pressure
- **System Status** — Fixed display issues and data rendering
- **Data Export** — Fixed export job handling
- **7 API mismatches** — Fixed snake_case/camelCase mismatches across API responses
- **Signal source-of-truth** — Established `vehicle_live_state` as canonical signal source
- **Error handling** — Added error boundaries and error handling to 16 frontend pages
- **Telemetry timeout** — Extracted to configuration for consistent timeout handling

### 🔧 Changed
- Maintenance worker now refreshes materialized views and generates battery snapshots daily
- Error handling added to 16 frontend pages with consistent patterns
- Signal source-of-truth established as `vehicle_live_state` table
- Telemetry timeout extracted to config

### 🗃️ Database Migrations (040–057)
- **040–052**: Error handling, API normalization, config extraction, signal source-of-truth, system status fixes, data export fixes, decimal precision, pressure unit setting
- **053**: Materialized views (`mv_energy_daily`, `mv_position_hourly`, `mv_signal_stats`)
- **054**: Tire pressure friendly labels and zero-value filtering
- **055**: Cleanup migration for zero-value positions and tire pressure
- **056**: Position (0,0) cleanup migration
- **057**: Battery health snapshot backfill from charging telemetry

### 🚀 New Features

#### CEP Rule Engine & Alert Studio
- **Complex Event Processing (CEP)** rule engine (`internal/api/rule_engine.go`) with recursive condition tree evaluation
  - Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `changed_to`, `changed_from`, `is_true`, `is_false`
  - Temporal conditions: `for_seconds` — condition must sustain for duration before firing
  - Transition detection: `changed_to` / `changed_from` compares current vs previous signal values per rule/vehicle
  - Per-rule cooldown (configurable, default 15 min) with in-memory + DB tracking
  - Message templates with signal interpolation: `{{BatteryLevel}}`, `{{VehicleSpeed}}`, etc.
- **Alert Studio** (`/alert-studio`) — visual CEP rule editor with:
  - 50+ pre-built rule templates across 12 categories (Battery, Charging, Climate, Driving, Security, Geofence, Maintenance, Software, Efficiency, Fleet, Safety, Custom)
  - **RuleBuilder** component — visual condition tree editor with signal picker, category grouping, context-aware operators, AND/OR groups
  - **Signal Catalog** — 230 signal metadata entries with name, category, type, unit, and description (`web/src/lib/signalCatalog.ts`)
  - Test notification button with real-time signal value interpolation
  - Notification channel selection per rule
  - Severity levels (info/warning/critical) with configurable cooldown
- **Quiet Hours** — server-side suppression of non-critical alerts during configured hours; critical alerts always fire regardless
- **Test Notifications** — `POST /api/v1/alerts/test` fires a test alert with template rendering, SSE broadcast, and dispatch to selected channels
- 7 new **Prometheus metrics** for CEP: `cep_active_rules`, `cep_rules_evaluated_total`, `cep_rules_cooldown_skipped_total`, `cep_eval_duration_seconds`, `alerts_fired_total`, `alerts_suppressed_quiet_hours_total`, `cep_condition_errors_total`
- New Grafana dashboard: **CEP Rule Engine** (12 panels) — active rules, eval rate, alerts fired, cooldown skips, latency percentiles, condition errors, fired by severity/rule

#### 100% Signal Coverage & Persistence
- 229/230 Fleet Telemetry signals now persisted in `vehicle_live_state` (up from ~70)
- Migration 035: Added 158 new columns to `vehicle_live_state` for complete signal coverage
- All signal categories covered: Vehicle State, Vehicle Config, Powertrain, Climate, Security, Safety, TPMS, Software, User Preferences, Service
- `signalToColumn` map expanded to 229 entries with special handling for Location (JSON→lat/lon), enum→boolean conversions (45 signals), and shared columns (AC/DC charging power)
- Pod restart recovery: all signals survive restarts via DB persistence + `LoadFromDB()`

#### SSE Singleton Architecture & New Metrics
- **SSE singleton manager** (`web/src/lib/sseManager.ts`) — one EventSource connection per browser tab shared across all hooks
- All `useRealtimeEvents` / `useVehicleLive` hooks subscribe/unsubscribe to shared connection (was: 16 separate connections)
- 4 new SSE Prometheus metrics: `sse_events_dropped_total`, `sse_connections_total`, `sse_broadcast_duration_seconds`, `sse_bytes_sent_total`
- New Grafana dashboard: **SSE & Real-Time** (18 panels) — active clients, events by type, bandwidth, broadcast latency (p50/p95/p99), drops, connection churn, MQTT status

#### State Machine Improvements
- Gear-based state transitions (instant) with speed as fallback (30s debounce, 2min drive hold)
- Traffic light fix: checks SignalStore for Gear=D/R before ending speed-based drives (gear signals only fire on CHANGE)
- Charging orphan guard: starting a drive force-completes any active charge session
- Stale gear freshness: cached gear older than 10min ignored for state detection
- `asleep` vs `offline` state distinction (parked+no-telemetry vs driving+no-telemetry)
- `Completing` flag prevents double-completion race between cleanup timer and normal completion
- State machine fields persisted to `vehicle_live_state` (_LastGear, _LastSpeedTime)

#### Adaptive Polling & UX
- **Adaptive polling** (`useAdaptiveInterval` hook) — 3s when SSE disconnected, 30s when connected
- **Decimal precision setting** — configurable 0-4 decimal places with global enforcement via `numberFormat.ts`
- **Global SSE alert toast** in `Layout.tsx` — CEP alerts appear as browser toasts (error/warning/info by severity)
- `parseSettingEnum` utility for displaying Tesla enum values in human-readable form

#### Signal Coverage on UI Pages
- ~147 signals surfaced across all UI pages:
  - Vehicle State (22), Vehicle Config (14), Software Updates (5), User Preferences (5)
  - Service/TPMS (11), Safety (14), Powertrain (~35), Climate (29)
- All 16 data pages now receive SSE live data via `useVehicleLive` hook

#### Granular API Endpoint Polling Controls
- Per-endpoint toggles for 20 Tesla Fleet API endpoints across three categories:
  - **Polling** (7): Vehicle Discovery, Charge State, Climate State, Drive State, Location Data, Vehicle State, Vehicle Config
  - **On-Demand** (11): Separate toggles for the same 7 endpoints when triggered manually, plus Nearby Charging Sites, Release Notes, Recent Alerts, Service Data
  - **Commands** (2): Wake Up, Vehicle Commands
- Polling and on-demand toggles are independent — disable auto-polling for an endpoint while keeping manual use via the UI
- New Settings UI section: "API Endpoint Controls" with grouped toggle grid
- New API endpoints: `GET/PUT /api/v1/settings/polling-config`
- Database migration: `polling_config` JSONB column on settings table
- All toggles default to enabled — existing behavior preserved
- Global `api_suspended` master switch continues to override all toggles

### 🐛 Bug Fixes
- Fixed `charger_power specified more than once` — duplicate signalToColumn mapping for AC/DC charging power
- Fixed 6 column type mismatches (boolean columns receiving enum strings like `HvacAutoModeStateOn`)
- Fixed `concurrent map iteration and map write` crash — copy signals map before passing to MongoDB goroutine
- Fixed firmware not showing — `/live` endpoint wrapped signals in `{value, timestamp}` but `parseSignals` expected flat format
- Fixed SSE token/connection leak — 16 pages each opening their own SSE connection, replaced with singleton manager
- Fixed Energy Flow page showing "—" while charging — added SSE live data overlay
- Fixed fresh install compatibility — updated original CREATE TABLE migrations with correct column types
- Fixed false drive-end at traffic lights — check SignalStore for Gear=D/R before ending speed-based drives
- Fixed test notification sending raw `{{BatteryLevel}}` templates — now renders with real signal values from SignalStore

### 📊 Grafana Dashboards (28 total, +2 new)
- **CEP Rule Engine** (12 panels) — active rules, eval rate, alerts fired, cooldown skips, latency, errors by severity/rule
- **SSE & Real-Time** (18 panels) — active clients, events by type, bandwidth, broadcast latency, drops, MQTT status
- Fixed 21 non-existent Prometheus metrics in infrastructure dashboards (replaced with real ones)
- Fixed 8 SQL queries with wrong column names in system dashboards
- Fixed 14 legend label mismatches (panels showing "—" instead of metric names)
- Added enriched views (`v_drives`, `v_charging_sessions`) with NULLIF for zero-value protection
- Enhanced 5 system dashboards with 14 new panels (security, climate, battery, tire, drivetrain)

### 🗃️ Database Migrations (030–039)
- **030**: Vehicle state + config columns on `vehicle_live_state`
- **031**: Decimal precision setting
- **032**: Seed `software_updates` from `vehicle_config_snapshots`
- **033**: Enriched views (`v_drives`, `v_charging_sessions`)
- **034**: State machine persistence (`last_gear`, `last_speed_time`)
- **035**: Complete live state — 158 columns for 100% signal coverage
- **036**: CEP rule engine (`conditions` JSONB, `cooldown_min`, `severity`, `msg_template`, `notify_channels`, `tags`, `fire_count`, `last_fired_at`)
- **037**: Fix column types (boolean → varchar for enum signals)
- **038**: Fix `vehicle_config` types (boolean → varchar)
- **039**: Quiet hours + alert digest mode on settings table

## [0.7.0] — 2026-03-29

### 🚀 New Features

#### Comprehensive Telemetry Expansion (228/228 Tesla Fields)
- New DB migration (000017): 78 new columns + 6 new tables for complete Tesla signal coverage
- charging_telemetry: 55-column real-time charging data (pack voltage/current, cell voltages, BMS, powershare)
- media_snapshots: now playing, volume, playback source
- vehicle_config_snapshots: trim, color, software updates
- location_snapshots: navigation destination, route, home/work/favorite detection
- safety_snapshots: ADAS settings, collision warnings, FSD miles
- user_preference_snapshots: unit settings, time format
- Expanded motor_snapshots: quad-motor support (torque/speed/state/temps for F/R/REL/RER)
- Expanded climate_snapshots: seat heaters (5 positions), steering wheel heat, auto climate
- Expanded security_events: lights, tonneau, seat belts, valet/service modes

#### 5 New UI Pages (51 total)
- **Energy Flow** — Pack voltage/current, cell balance, module temps, BMS status, powershare
- **Drivetrain Health** — Quad-motor thermal monitoring, stator/heatsink/inverter temps
- **Media Player** — Now playing, volume, playback history, source distribution
- **Safety Settings** — ADAS configuration, collision warnings, FSD statistics
- **Navigation** — Active route, destination, home/work/favorite indicators

#### 4 New Grafana Dashboards (26 total)
- Energy Flow: pack voltage/current, charging power, cell spread, BMS
- Drivetrain Thermal: stator/heatsink/inverter temps, motor currents
- Comfort & Media: seat heaters, HVAC modes, now playing, volume
- Vehicle Intelligence: config, software, safety, navigation, preferences

#### 4 New Tesla Fleet API Integrations
- Nearby Charging Sites — show Superchargers near vehicle
- Release Notes — firmware update release notes
- Recent Alerts — vehicle alerts from Tesla (recalls, service)
- Service Data — service history and status

#### Enhanced Existing Pages
- Dashboard: added media/entertainment and navigation live cards
- VehicleDetail: added energy/charging pack data and media/nav panels
- Settings: Re-authorize and Disconnect buttons for Tesla account

### 🔧 Fleet Telemetry Fixes
- Fleet telemetry config uses MQTT dispatcher (was HTTP)
- Let's Encrypt ISRG Root X1 CA certificate auto-included in subscription
- Added vehicle_location OAuth scope for location telemetry fields
- Added prompt=consent to force OAuth scope re-approval
- 228/228 Tesla fields verified against official Available Data page
- Key pairing via tesla.com/_ak link (replaced broken API call)
- .well-known path bypasses Authentik authentication
- Fixed fleet telemetry image: tesla/fleet-telemetry (Docker Hub, not GHCR)
- Command proxy: writable filesystem fix
- Removed invalid fields: Latitude, Longitude (standalone), FrunkOpen, TrunkOpen, WindowState
- Added minimum_delta for SelfDrivingMilesSinceReset
- Removed invalid alert_type "security"

### 🐛 Bug Fixes
- Disconnect properly clears DB token + in-memory client state
- TokenRepo.Delete() method for clean disconnection

## [0.6.0] - 2026-03-28

### 🚀 New Features

#### 10 New Pages
- **Driving Dynamics** — Real-time motor torque gauges, G-force visualization, acceleration patterns, pedal usage tracking, stator temperature monitoring
- **Climate Control** — HVAC power & fan speed monitoring, thermal comfort scoring, cabin/outside temperature trends, defrost and battery heater status
- **Security & Access** — SVG vehicle visualization with lock/sentry/door/window status indicators, security event timeline, sentry activity charts
- **Charging Curve** — Charge rate (kW) vs SOC% curve visualization, multi-session overlay comparison, charging speed degradation trend analysis
- **Cost Analysis** — Monthly/yearly cost trends, cost-per-mile tracking, interactive gas vs electric savings calculator, lifetime savings counter
- **Battery Cells** — Cell voltage spread gauge, module temperature balance, 4×23 pack grid visualization, cell balance scoring, degradation correlation
- **Drive Score** — Gamified 0-100 driving efficiency scoring with animated gauge, efficiency/smoothness/speed breakdown, improvement tips, score trends
- **Weekly Digest** — Auto-generated weekly car summary with drive highlights, charging summary, fun facts, week-over-week comparison, notable events
- **Maintenance Tracker** — Service schedule with 8 maintenance items, odometer-based progress bars, localStorage service log, annual cost estimates
- **Data Export** — Export drives, charging, analytics in CSV/JSON format with date range filtering, export job management and download

#### Enhanced Existing Pages
- **Dashboard** — New "Live Telemetry" section with real-time drivetrain, climate, security, and tire pressure cards
- **Vehicle Detail** — 4 comprehensive telemetry panels: powertrain, climate, security, tire pressure with 3-second auto-refresh
- **Charging** — Enhanced session cards with cable type badges, charger specs, charging efficiency, new charger specs breakdown panel

#### Backend — New Telemetry Storage
- New database migration (000016): `motor_snapshots`, `climate_snapshots`, `security_events` tables
- Telemetry handler now stores motor/powertrain signals (torque, RPM, G-forces, pedal, brake, gear)
- Telemetry handler now stores climate/HVAC signals (temps, power, fan speed, defrost, heater)
- Telemetry handler now stores security signals (locks, sentry, doors, windows, HomeLink)
- New API endpoints: `GET /motor`, `GET /climate`, `GET /security` (list + latest)
- New `GET /drives/{id}/positions` endpoint for time-windowed route data
- Energy Stats API enriched with distance, efficiency (Wh/km), and CO₂ saved data

#### Testing & Data Generation
- Continuous MQTT load test with 8 simulated vehicles on real US routes
- Historical data generator: 145K+ records spanning 10 years (2016-2026) across all tables

### 🐛 Bug Fixes
- **Unit conversion** — Fixed 14 pages hardcoding metric units; now respects user's km/mi and °C/°F preferences
- **Mobile layout** — Fixed last panel getting cut off on all screens (h-screen → h-dvh + safe-area padding)
- **Map tiles** — Fixed invisible CARTO dark map tiles (brightness filter too aggressive)
- **Tire pressure** — Fixed bar→PSI conversion, composite latest from history for partial snapshots
- **Tire pressure signals** — Added TpmsPressureFl/Fr/Rl/Rr signal name variant recognition
- **Energy API** — Fixed response missing total_distance_km, avg_efficiency_wh_km, co2_saved_kg fields
- **Drive routes** — Fixed empty route map on DriveDetail by adding time-windowed position query
- **Drive addresses** — Show lat/lon coordinates instead of "Unknown" for start/destination
- **Sidebar nav** — Fixed raw i18n keys showing for new pages (fallback to label when translation missing)

## [0.5.0] - 2026-03-23

### 🏗 Architecture
- **Single-route ingress** — All traffic now routes through a single Traefik IngressRoute (or standard Ingress) pointing to `teslasync-web` (Nginx). Nginx serves static files AND proxies `/api/`, `/.well-known/`, `/healthz`, `/readyz`, `/metrics` to `teslasync-api` over the internal Kubernetes cluster network. API traffic no longer traverses the ingress controller — only the initial page load does.
- **Nginx reverse proxy** — `teslasync-web` now acts as both static file server and reverse proxy. The `config.apiEndpoint` Helm value configures the Nginx `proxy_pass` target (defaults to auto-derived `http://<release>-api:<port>`) and is injected into the frontend at runtime via Nginx `sub_filter` as `window.__TESLASYNC_API_BASE__`.

### 🚀 Features
- **Sleep backoff for asleep vehicles** — When a vehicle returns 408 (asleep), polling now backs off exponentially using `WORKER_SLEEP_POLL_MULT` (default 4×): 60s → 120s → 240s → 10 min cap. Previously, asleep vehicles were polled every 15s with no backoff.
- **API Suspend Toggle** — New toggle on the Settings page to suspend ALL Tesla Fleet API calls. Useful when a vehicle is in service. Persisted in DB (`api_suspended` column on `settings` table, migration 000011). Token refresh continues during suspension so re-auth isn't needed. All API entry points are blocked: worker polling, CurrentState, SyncFromTesla, Wake, SendCommand.
- **API Usage Dashboard fix** — `APIUsageHandler` now queries `api_call_logs` table for real monthly request counts, skipped polls (408/504), and estimated cost vs Tesla's $10/month credit. Previously returned hardcoded zeros.

### 🔧 Fixes
- **SPA routing fix** — Replaced Go `fileServer` catch-all with `r.NotFound()` SPA fallback. Go Dockerfile now includes a `web-builder` stage so the Go container bundles frontend assets. Router auto-detects static dir (`/web/dist` in Docker, `./web/dist` local).
- **Traefik IngressRoute fix** — `PathPrefix('/api')` matched frontend routes `/api-logs` and `/api-keys`. Fixed to `PathPrefix('/api/')` (trailing slash).

### ⎈ Helm
- **Single-route ingress** — All traffic now routes through one ingress path (`/`) to `teslasync-web`. Nginx proxies API paths internally to `teslasync-api` over the cluster network. Removed the separate `/api` ingress path.
- **Helm chart v0.5.0** — Service exposure: `service.type`, `service.nodePort`, `service.loadBalancerIP`, `service.externalTrafficPolicy`, `service.annotations` (same for `web.service.*`)
- **New config fields** — `config.apiEndpoint` (configures Nginx proxy_pass target and frontend API base URL via `sub_filter`), `config.webEndpoint` (public URL for CORS)
- **`tesla.redirectUri`** remains explicit (public-facing, Tesla calls it)

### 📖 Documentation
- **CHANGELOG** — Added 0.5.0 release notes with architecture changes
- **README** — Updated architecture diagram to show single-route ingress and Nginx proxy layer, updated deployment section
- **Helm README** — Updated architecture diagram, rewrote ingress configuration for single-route pattern, added API Routing section, updated `config.apiEndpoint` description
- **Kubernetes deployment guide** — Updated with single-route ingress examples for both Traefik IngressRoute and standard Ingress
- **Architecture docs** — Updated high-level overview diagram and added traffic flow explanation
- **Configuration guide** — Added Kubernetes/Helm configuration section explaining `config.apiEndpoint` dual purpose
- **.env.example** — Added sleep backoff and API suspend comments

## [0.4.0] - 2026-03-23

### 🛠 Developer Tools
- **Developer Tools page** — 25+ built-in utilities accessible from sidebar nav
- **Tesla Fleet API tools** — Region detection, partner registration, API connectivity test, token inspector
- **Public key management** — Generate ECDSA P-256 keypairs in-app, auto-serve at `.well-known` path, upload existing keys, fingerprint display
- **Infrastructure diagnostics** — Database stats, migration status, MQTT test, env check, runtime info
- **Client-side utilities** — VIN decoder, JWT decoder, timestamp converter, Base64, URL encoder, JSON formatter, UUID generator, SHA-256 hash, byte converter, color converter, cron parser, HTTP status reference, Tesla API endpoint reference, regex tester, Unix permission calculator

### 📡 Fleet Telemetry
- **Status UI** — Fleet Telemetry card in System Status page (enabled/disabled with details)
- **Signal display** — Shows supported signals, endpoint, protocol, host:port when enabled
- **Setup hints** — Displays configuration instructions when disabled
- **Fleet Telemetry config** — New `FleetTelemetryConfig` with `FLEET_TELEMETRY_ENABLED`, `FLEET_TELEMETRY_HOST`, `FLEET_TELEMETRY_PORT` env vars

### 📊 API Call Log Enhancement
- **Source tagging** — API call logs now distinguish `tesla_api` vs `fleet_telemetry` sources
- **Database migration** — Migration 000009 adds `source` column with index to `api_call_logs`
- **Telemetry logging** — Incoming fleet telemetry ingests logged with `source: fleet_telemetry`

### 🔧 Configuration
- **`TESLA_API_BASE_URL`** — Configurable Fleet API region (NA/EU/CN) via env var, docker-compose, and Helm
- **Fleet Telemetry env vars** — `FLEET_TELEMETRY_ENABLED`, `FLEET_TELEMETRY_HOST`, `FLEET_TELEMETRY_PORT`

### 📖 Documentation
- **README** — Updated features, API endpoints, highlights for Developer Tools
- **CHANGELOG** — Added 0.4.0 release notes
- **.env.example** — Added `TESLA_API_BASE_URL` and fleet telemetry env vars
- **Fleet Telemetry guide** — Updated with status UI documentation

## [0.3.0] - 2026-03-22

### 🏗 Architecture
- **Microservice split** — Dedicated notification worker container (`teslasync-notification-worker`)
- **Event-driven design** — Domain event bus via MQTT (`drive.started`, `charge.completed`, etc.)
- **Pod renaming** — Backend deployment renamed from `teslasync` to `teslasync-api` for clarity
- **Redis caching layer** — Two-tier cache (in-memory L1 + Redis L2) with automatic fallback

### 🔐 Security
- **AES-256-GCM encryption** — Encrypt Tesla tokens and sensitive data at rest (`ENCRYPTION_KEY`)
- **Command whitelist** — Only 21 known Tesla commands accepted, rejects unknown
- **Request body size limit** — Global 1MB `MaxBytesReader` middleware prevents DoS
- **CORS hardened** — Configurable origins via `CORS_ORIGINS` env var
- **Input validation** — Geofence coordinates, alert rule types/severity, settings values, import rows
- **Per-route rate limiting** — Commands: 20/min, exports: 10/min, reads: 100/min
- **Default credentials removed** — `.env.example` uses `changeme` placeholders
- **Nginx hardened** — Added HSTS, Permissions-Policy, proxy timeouts, body size limits

### 📬 Notifications
- **Notification scheduling** — One-time or cron-based recurring notifications
- **Notification preferences** — Per-event-type enable/disable per channel
- **Notification analytics** — Delivery rates, latency tracking, per-channel metrics
- **Async delivery** — MQTT-backed queue with 3x retry and exponential backoff
- **Metrics tracking** — Automatic delivery success/failure recording per channel/day

### 📊 Observability
- **Version endpoint** — `/api/v1/system/version` returns app version, chart version, Go version, OS/arch, uptime, goroutines
- **Update checker** — `/api/v1/system/update-check` checks GitHub releases (cached 1hr)
- **Circuit breaker state** — Exposed in `/api/v1/system/status` with counts
- **API log retention** — Automatic cleanup of logs >30 days
- **Notification log retention** — Automatic cleanup of logs >90 days

### 🎨 Frontend
- **Version badge** — Sidebar shows actual Helm chart version
- **Update notification** — Banner when newer release is available
- **Circuit breaker UX** — Friendly "Tesla API unavailable, auto-retry in Xs" with countdown
- **Settings page** — Shows live version info, Go version, encryption status
- **ErrorBoundary** — Enhanced to detect circuit breaker and network errors separately

### ⚙️ CI/CD
- **3 Docker images** — api, web, notification-worker (all built and pushed in release workflow)
- **GoReleaser** — Notification worker binary added for cross-platform builds
- **CI pipeline** — Both binaries built and tested

### 📖 Documentation
- **Architecture docs** — Updated package tree, event-driven diagrams, notification worker sequence
- **Configuration docs** — Redis, encryption, CORS, system env vars documented
- **Fleet Telemetry guide** — Expanded from 129 to 423 lines with MQTT integration, Home Assistant examples
- **README** — Updated highlights, service count, new API endpoints

## [0.1.0] - 2026-03-21

### 🚀 Features
- **29 interactive dashboard pages** with glassmorphism UI
- **5 color themes** × 4 display modes (dark, light, OLED, midnight)
- **Real-time SSE streaming** with auto-reconnect and event buffering
- **14 remote vehicle commands** (lock, unlock, climate, sentry, charge, frunk, trunk, horn, flash)
- **Smart Insights Engine** — auto-generated recommendations from driving/charging data
- **Drive Score** rating system (0-100 animated gauge)
- **16 Grafana dashboards** with verified SQL queries
- **Futuristic tire pressure visualization** with animated car SVG
- **Smart charging optimizer** with cost comparison by charger type
- **Monthly statistics tables** with inline spark bars
- **Charging cost analytics** — cost per kWh tracking, location comparison
- **State timeline bars** — Gantt-style vehicle state visualization
- **Software update timeline** — version progression chart
- **Projected range calculator** with weather/driving condition adjustments
- **Vehicle comparison page** — side-by-side metrics with radar chart
- **Total cost of ownership calculator** — EV vs gas comparison
- **Trip planner** with range estimation and charging stop calculation
- **PDF report generation** for drives and monthly summaries
- **Global search** across vehicles, drives, locations in command palette
- **Fleet efficiency leaderboard** with rankings
- **Onboarding wizard** — 4-step first-time setup
- **API key management** with HMAC-SHA256 authentication
- **Inbound webhook API** for external system integration
- **7-channel notifications** (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover)
- **12 configurable alert types** with quiet hours and digest mode
- **Data privacy controls** — anonymize locations, GDPR export
- **Unit preferences** — km/mi, °C/°F applied across all pages

### 🔧 Infrastructure
- **PostgreSQL 17** with native partitioning (replaced TimescaleDB)
- **Helm chart v0.3.0** — embedded/external services, IngressRoute, HPA, PDB
- **14 GitHub Actions workflows** — CI, Docker, security, quality, release
- **Tesla Fleet API billing optimization** — adaptive polling ($3/month vs $192)
- **Docker Compose** — 6 services (API, Web, PostgreSQL, Redis, MQTT, Grafana)
- **127 automated tests** (84 Go + 43 frontend)
- **E2E test suite** with 25+ endpoint checks
- **SBOM generation** + container image signing
- **Dependabot** for Go, npm, Docker, Actions dependencies

### 📝 Documentation
- **VitePress docs site** with Mermaid diagrams and automotive animations
- **54-endpoint API reference** with JSON examples
- **Complete database schema** documentation (21 tables)
- **Technology stack** rationale
- **Troubleshooting guide** + FAQ
- **Roadmap** with 4 release tiers

### 🔒 Security
- **CodeQL** SAST for Go + JavaScript
- **govulncheck** for Go CVE scanning
- **HMAC webhook signatures**
- **API key auth middleware**
- **Rate limiting** (100 req/min per IP)
- **Security headers** (HSTS, CSP, X-Frame-Options)
