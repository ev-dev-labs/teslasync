//
//  ChangelogModal.Catalog.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The native port of the web generated `CHANGELOG` (web/src/generated/changelog.ts, itself generated
//  from the repo-root CHANGELOG.md) — every release the modal advertises, newest-first, with each
//  release's badge classification and its flat list of Keep-a-Changelog changes. The web component reads
//  the static generated constant directly; the native surface ships the same six-release table and
//  delivers it through the bound source so the view stays source-driven + testable. This is ported
//  product data (release notes), not generated chrome — the change text is rendered verbatim, mirroring
//  the web rendering `item.text` and `entry.date` directly (the only localized strings on this surface
//  are the section headings, the badge labels, and the modal chrome — see ChangelogModal.strings). The
//  rows are kept one-per-line so the table reads as data; the raised max-width is scoped to this file.
//
// swiftformat:options --maxwidth 500

import Foundation

/// The release-history registry — the native parity of the web generated `CHANGELOG`. Exposed newest
/// first (the projection selects the unseen subset + groups each entry); `latestVersion` mirrors the web
/// `LATEST_VERSION`.
public enum ChangelogCatalog {
    /// A terse change factory keeping the release tables readable (ported data, one row per change).
    private static func chg(_ type: ChangelogChangeType, _ text: String) -> ChangelogChange {
        ChangelogChange(type: type, text: text)
    }

    /// A terse release factory pairing a version + date + badge with its pre-built changes array.
    private static func rel(
        _ version: String,
        _ date: String,
        _ badge: ChangelogBadgeKind,
        _ changes: [ChangelogChange]
    ) -> ChangelogReleaseEntry {
        ChangelogReleaseEntry(version: version, date: date, badge: badge, changes: changes)
    }

    // swiftlint:disable line_length
    private static let changes070: [ChangelogChange] = [
        chg(.added, "Comprehensive Telemetry Expansion (228/228 Tesla Fields): New DB migration (000017): 78 new columns + 6 new tables for complete Tesla signal coverage"),
        chg(.added, "charging_telemetry: 55-column real-time charging data (pack voltage/current, cell voltages, BMS, powershare)"),
        chg(.added, "media_snapshots: now playing, volume, playback source"),
        chg(.added, "vehicle_config_snapshots: trim, color, software updates"),
        chg(.added, "location_snapshots: navigation destination, route, home/work/favorite detection"),
        chg(.added, "safety_snapshots: ADAS settings, collision warnings, FSD miles"),
        chg(.added, "user_preference_snapshots: unit settings, time format"),
        chg(.added, "Expanded motor_snapshots: quad-motor support (torque/speed/state/temps for F/R/REL/RER)"),
        chg(.added, "Expanded climate_snapshots: seat heaters (5 positions), steering wheel heat, auto climate"),
        chg(.added, "Expanded security_events: lights, tonneau, seat belts, valet/service modes"),
        chg(.added, "5 New UI Pages (51 total): **Energy Flow** — Pack voltage/current, cell balance, module temps, BMS status, powershare"),
        chg(.added, "**Drivetrain Health** — Quad-motor thermal monitoring, stator/heatsink/inverter temps"),
        chg(.added, "**Media Player** — Now playing, volume, playback history, source distribution"),
        chg(.added, "**Safety Settings** — ADAS configuration, collision warnings, FSD statistics"),
        chg(.added, "**Navigation** — Active route, destination, home/work/favorite indicators"),
        chg(.added, "4 New Grafana Dashboards (26 total): Energy Flow: pack voltage/current, charging power, cell spread, BMS"),
        chg(.added, "Drivetrain Thermal: stator/heatsink/inverter temps, motor currents"),
        chg(.added, "Comfort & Media: seat heaters, HVAC modes, now playing, volume"),
        chg(.added, "Vehicle Intelligence: config, software, safety, navigation, preferences"),
        chg(.added, "4 New Tesla Fleet API Integrations: Nearby Charging Sites — show Superchargers near vehicle"),
        chg(.added, "Release Notes — firmware update release notes"),
        chg(.added, "Recent Alerts — vehicle alerts from Tesla (recalls, service)"),
        chg(.added, "Service Data — service history and status"),
        chg(.added, "Enhanced Existing Pages: Dashboard: added media/entertainment and navigation live cards"),
        chg(.added, "VehicleDetail: added energy/charging pack data and media/nav panels"),
        chg(.added, "Settings: Re-authorize and Disconnect buttons for Tesla account"),
        chg(.changed, "Fleet telemetry config uses MQTT dispatcher (was HTTP)"),
        chg(.changed, "Let's Encrypt ISRG Root X1 CA certificate auto-included in subscription"),
        chg(.changed, "Added vehicle_location OAuth scope for location telemetry fields"),
        chg(.changed, "Added prompt=consent to force OAuth scope re-approval"),
        chg(.changed, "228/228 Tesla fields verified against official Available Data page"),
        chg(.changed, "Key pairing via tesla.com/_ak link (replaced broken API call)"),
        chg(.changed, ".well-known path bypasses Authentik authentication"),
        chg(.changed, "Fixed fleet telemetry image: tesla/fleet-telemetry (Docker Hub, not GHCR)"),
        chg(.changed, "Command proxy: writable filesystem fix"),
        chg(.changed, "Removed invalid fields: Latitude, Longitude (standalone), FrunkOpen, TrunkOpen, WindowState"),
        chg(.changed, "Added minimum_delta for SelfDrivingMilesSinceReset"),
        chg(.changed, "Removed invalid alert_type \"security\""),
        chg(.fixed, "Disconnect properly clears DB token + in-memory client state"),
        chg(.fixed, "TokenRepo.Delete() method for clean disconnection")
    ]

    private static let changes060: [ChangelogChange] = [
        chg(.added, "10 New Pages: **Driving Dynamics** — Real-time motor torque gauges, G-force visualization, acceleration patterns, pedal usage tracking, stator temperature monitoring"),
        chg(.added, "**Climate Control** — HVAC power & fan speed monitoring, thermal comfort scoring, cabin/outside temperature trends, defrost and battery heater status"),
        chg(.added, "**Security & Access** — SVG vehicle visualization with lock/sentry/door/window status indicators, security event timeline, sentry activity charts"),
        chg(.added, "**Charging Curve** — Charge rate (kW) vs SOC% curve visualization, multi-session overlay comparison, charging speed degradation trend analysis"),
        chg(.added, "**Cost Analysis** — Monthly/yearly cost trends, cost-per-mile tracking, interactive gas vs electric savings calculator, lifetime savings counter"),
        chg(.added, "**Battery Cells** — Cell voltage spread gauge, module temperature balance, 4×23 pack grid visualization, cell balance scoring, degradation correlation"),
        chg(.added, "**Drive Score** — Gamified 0-100 driving efficiency scoring with animated gauge, efficiency/smoothness/speed breakdown, improvement tips, score trends"),
        chg(.added, "**Weekly Digest** — Auto-generated weekly car summary with drive highlights, charging summary, fun facts, week-over-week comparison, notable events"),
        chg(.added, "**Maintenance Tracker** — Service schedule with 8 maintenance items, odometer-based progress bars, localStorage service log, annual cost estimates"),
        chg(.added, "**Data Export** — Export drives, charging, analytics in CSV/JSON format with date range filtering, export job management and download"),
        chg(.added, "Enhanced Existing Pages: **Dashboard** — New \"Live Telemetry\" section with real-time drivetrain, climate, security, and tire pressure cards"),
        chg(.added, "**Vehicle Detail** — 4 comprehensive telemetry panels: powertrain, climate, security, tire pressure with 3-second auto-refresh"),
        chg(.added, "**Charging** — Enhanced session cards with cable type badges, charger specs, charging efficiency, new charger specs breakdown panel"),
        chg(.added, "Backend — New Telemetry Storage: New database migration (000016): `motor_snapshots`, `climate_snapshots`, `security_events` tables"),
        chg(.added, "Telemetry handler now stores motor/powertrain signals (torque, RPM, G-forces, pedal, brake, gear)"),
        chg(.added, "Telemetry handler now stores climate/HVAC signals (temps, power, fan speed, defrost, heater)"),
        chg(.added, "Telemetry handler now stores security signals (locks, sentry, doors, windows, HomeLink)"),
        chg(.added, "New API endpoints: `GET /motor`, `GET /climate`, `GET /security` (list + latest)"),
        chg(.added, "New `GET /drives/{id}/positions` endpoint for time-windowed route data"),
        chg(.added, "Energy Stats API enriched with distance, efficiency (Wh/km), and CO₂ saved data"),
        chg(.added, "Testing & Data Generation: Continuous MQTT load test with 8 simulated vehicles on real US routes"),
        chg(.added, "Historical data generator: 145K+ records spanning 10 years (2016-2026) across all tables"),
        chg(.fixed, "**Unit conversion** — Fixed 14 pages hardcoding metric units; now respects user's km/mi and °C/°F preferences"),
        chg(.fixed, "**Mobile layout** — Fixed last panel getting cut off on all screens (h-screen → h-dvh + safe-area padding)"),
        chg(.fixed, "**Map tiles** — Fixed invisible CARTO dark map tiles (brightness filter too aggressive)"),
        chg(.fixed, "**Tire pressure** — Fixed bar→PSI conversion, composite latest from history for partial snapshots"),
        chg(.fixed, "**Tire pressure signals** — Added TpmsPressureFl/Fr/Rl/Rr signal name variant recognition"),
        chg(.fixed, "**Energy API** — Fixed response missing total_distance_km, avg_efficiency_wh_km, co2_saved_kg fields"),
        chg(.fixed, "**Drive routes** — Fixed empty route map on DriveDetail by adding time-windowed position query"),
        chg(.fixed, "**Drive addresses** — Show lat/lon coordinates instead of \"Unknown\" for start/destination"),
        chg(.fixed, "**Sidebar nav** — Fixed raw i18n keys showing for new pages (fallback to label when translation missing)")
    ]

    private static let changes050: [ChangelogChange] = [
        chg(.added, "**Sleep backoff for asleep vehicles** — When a vehicle returns 408 (asleep), polling now backs off exponentially using `WORKER_SLEEP_POLL_MULT` (default 4×): 60s → 120s → 240s → 10 min cap. Previously, asleep vehicles were polled every 15s with no backoff."),
        chg(.added, "**API Suspend Toggle** — New toggle on the Settings page to suspend ALL Tesla Fleet API calls. Useful when a vehicle is in service. Persisted in DB (`api_suspended` column on `settings` table, migration 000011). Token refresh continues during suspension so re-auth isn't needed. All API entry points are blocked: worker polling, CurrentState, SyncFromTesla, Wake, SendCommand."),
        chg(.added, "**API Usage Dashboard fix** — `APIUsageHandler` now queries `api_call_logs` table for real monthly request counts, skipped polls (408/504), and estimated cost vs Tesla's $10/month credit. Previously returned hardcoded zeros."),
        chg(.changed, "**Single-route ingress** — All traffic now routes through a single Traefik IngressRoute (or standard Ingress) pointing to `teslasync-web` (Nginx). Nginx serves static files AND proxies `/api/`, `/.well-known/`, `/healthz`, `/readyz`, `/metrics` to `teslasync-api` over the internal Kubernetes cluster network. API traffic no longer traverses the ingress controller — only the initial page load does."),
        chg(.changed, "**Nginx reverse proxy** — `teslasync-web` now acts as both static file server and reverse proxy. The `config.apiEndpoint` Helm value configures the Nginx `proxy_pass` target (defaults to auto-derived `http://<release>-api:<port>`) and is injected into the frontend at runtime via Nginx `sub_filter` as `window.__TESLASYNC_API_BASE__`."),
        chg(.changed, "**Single-route ingress** — All traffic now routes through one ingress path (`/`) to `teslasync-web`. Nginx proxies API paths internally to `teslasync-api` over the cluster network. Removed the separate `/api` ingress path."),
        chg(.changed, "**Helm chart v0.5.0** — Service exposure: `service.type`, `service.nodePort`, `service.loadBalancerIP`, `service.externalTrafficPolicy`, `service.annotations` (same for `web.service.*`)"),
        chg(.changed, "**New config fields** — `config.apiEndpoint` (configures Nginx proxy_pass target and frontend API base URL via `sub_filter`), `config.webEndpoint` (public URL for CORS)"),
        chg(.changed, "**`tesla.redirectUri`** remains explicit (public-facing, Tesla calls it)"),
        chg(.changed, "**CHANGELOG** — Added 0.5.0 release notes with architecture changes"),
        chg(.changed, "**README** — Updated architecture diagram to show single-route ingress and Nginx proxy layer, updated deployment section"),
        chg(.changed, "**Helm README** — Updated architecture diagram, rewrote ingress configuration for single-route pattern, added API Routing section, updated `config.apiEndpoint` description"),
        chg(.changed, "**Kubernetes deployment guide** — Updated with single-route ingress examples for both Traefik IngressRoute and standard Ingress"),
        chg(.changed, "**Architecture docs** — Updated high-level overview diagram and added traffic flow explanation"),
        chg(.changed, "**Configuration guide** — Added Kubernetes/Helm configuration section explaining `config.apiEndpoint` dual purpose"),
        chg(.changed, "**.env.example** — Added sleep backoff and API suspend comments"),
        chg(.fixed, "**SPA routing fix** — Replaced Go `fileServer` catch-all with `r.NotFound()` SPA fallback. Go Dockerfile now includes a `web-builder` stage so the Go container bundles frontend assets. Router auto-detects static dir (`/web/dist` in Docker, `./web/dist` local)."),
        chg(.fixed, "**Traefik IngressRoute fix** — `PathPrefix('/api')` matched frontend routes `/api-logs` and `/api-keys`. Fixed to `PathPrefix('/api/')` (trailing slash).")
    ]

    private static let changes040: [ChangelogChange] = [
        chg(.changed, "**Developer Tools page** — 25+ built-in utilities accessible from sidebar nav"),
        chg(.changed, "**Tesla Fleet API tools** — Region detection, partner registration, API connectivity test, token inspector"),
        chg(.changed, "**Public key management** — Generate ECDSA P-256 keypairs in-app, auto-serve at `.well-known` path, upload existing keys, fingerprint display"),
        chg(.changed, "**Infrastructure diagnostics** — Database stats, migration status, MQTT test, env check, runtime info"),
        chg(.changed, "**Client-side utilities** — VIN decoder, JWT decoder, timestamp converter, Base64, URL encoder, JSON formatter, UUID generator, SHA-256 hash, byte converter, color converter, cron parser, HTTP status reference, Tesla API endpoint reference, regex tester, Unix permission calculator"),
        chg(.changed, "**Status UI** — Fleet Telemetry card in System Status page (enabled/disabled with details)"),
        chg(.changed, "**Signal display** — Shows supported signals, endpoint, protocol, host:port when enabled"),
        chg(.changed, "**Setup hints** — Displays configuration instructions when disabled"),
        chg(.changed, "**Fleet Telemetry config** — New `FleetTelemetryConfig` with `FLEET_TELEMETRY_ENABLED`, `FLEET_TELEMETRY_HOST`, `FLEET_TELEMETRY_PORT` env vars"),
        chg(.changed, "**Source tagging** — API call logs now distinguish `tesla_api` vs `fleet_telemetry` sources"),
        chg(.changed, "**Database migration** — Migration 000009 adds `source` column with index to `api_call_logs`"),
        chg(.changed, "**Telemetry logging** — Incoming fleet telemetry ingests logged with `source: fleet_telemetry`"),
        chg(.changed, "**`TESLA_API_BASE_URL`** — Configurable Fleet API region (NA/EU/CN) via env var, docker-compose, and Helm"),
        chg(.changed, "**Fleet Telemetry env vars** — `FLEET_TELEMETRY_ENABLED`, `FLEET_TELEMETRY_HOST`, `FLEET_TELEMETRY_PORT`"),
        chg(.changed, "**README** — Updated features, API endpoints, highlights for Developer Tools"),
        chg(.changed, "**CHANGELOG** — Added 0.4.0 release notes"),
        chg(.changed, "**.env.example** — Added `TESLA_API_BASE_URL` and fleet telemetry env vars"),
        chg(.changed, "**Fleet Telemetry guide** — Updated with status UI documentation")
    ]

    private static let changes030: [ChangelogChange] = [
        chg(.changed, "**Microservice split** — Dedicated notification worker container (`teslasync-notification-worker`)"),
        chg(.changed, "**Event-driven design** — Domain event bus via MQTT (`drive.started`, `charge.completed`, etc.)"),
        chg(.changed, "**Pod renaming** — Backend deployment renamed from `teslasync` to `teslasync-api` for clarity"),
        chg(.changed, "**Redis caching layer** — Two-tier cache (in-memory L1 + Redis L2) with automatic fallback"),
        chg(.changed, "**Notification scheduling** — One-time or cron-based recurring notifications"),
        chg(.changed, "**Notification preferences** — Per-event-type enable/disable per channel"),
        chg(.changed, "**Notification analytics** — Delivery rates, latency tracking, per-channel metrics"),
        chg(.changed, "**Async delivery** — MQTT-backed queue with 3x retry and exponential backoff"),
        chg(.changed, "**Metrics tracking** — Automatic delivery success/failure recording per channel/day"),
        chg(.changed, "**Version endpoint** — `/api/v1/system/version` returns app version, chart version, Go version, OS/arch, uptime, goroutines"),
        chg(.changed, "**Update checker** — `/api/v1/system/update-check` checks GitHub releases (cached 1hr)"),
        chg(.changed, "**Circuit breaker state** — Exposed in `/api/v1/system/status` with counts"),
        chg(.changed, "**API log retention** — Automatic cleanup of logs >30 days"),
        chg(.changed, "**Notification log retention** — Automatic cleanup of logs >90 days"),
        chg(.changed, "**Version badge** — Sidebar shows actual Helm chart version"),
        chg(.changed, "**Update notification** — Banner when newer release is available"),
        chg(.changed, "**Circuit breaker UX** — Friendly \"Tesla API unavailable, auto-retry in Xs\" with countdown"),
        chg(.changed, "**Settings page** — Shows live version info, Go version, encryption status"),
        chg(.changed, "**ErrorBoundary** — Enhanced to detect circuit breaker and network errors separately"),
        chg(.changed, "**3 Docker images** — api, web, notification-worker (all built and pushed in release workflow)"),
        chg(.changed, "**GoReleaser** — Notification worker binary added for cross-platform builds"),
        chg(.changed, "**CI pipeline** — Both binaries built and tested"),
        chg(.changed, "**Architecture docs** — Updated package tree, event-driven diagrams, notification worker sequence"),
        chg(.changed, "**Configuration docs** — Redis, encryption, CORS, system env vars documented"),
        chg(.changed, "**Fleet Telemetry guide** — Expanded from 129 to 423 lines with MQTT integration, Home Assistant examples"),
        chg(.changed, "**README** — Updated highlights, service count, new API endpoints"),
        chg(.security, "**AES-256-GCM encryption** — Encrypt Tesla tokens and sensitive data at rest (`ENCRYPTION_KEY`)"),
        chg(.security, "**Command whitelist** — Only 21 known Tesla commands accepted, rejects unknown"),
        chg(.security, "**Request body size limit** — Global 1MB `MaxBytesReader` middleware prevents DoS"),
        chg(.security, "**CORS hardened** — Configurable origins via `CORS_ORIGINS` env var"),
        chg(.security, "**Input validation** — Geofence coordinates, alert rule types/severity, settings values, import rows"),
        chg(.security, "**Per-route rate limiting** — Commands: 20/min, exports: 10/min, reads: 100/min"),
        chg(.security, "**Default credentials removed** — `.env.example` uses `changeme` placeholders"), // parity:allow web changelog release-note copy (CHANGELOG.md)
        chg(.security, "**Nginx hardened** — Added HSTS, Permissions-Policy, proxy timeouts, body size limits")
    ]

    private static let changes010: [ChangelogChange] = [
        chg(.added, "**29 interactive dashboard pages** with glassmorphism UI"),
        chg(.added, "**5 color themes** × 4 display modes (dark, light, OLED, midnight)"),
        chg(.added, "**Real-time SSE streaming** with auto-reconnect and event buffering"),
        chg(.added, "**14 remote vehicle commands** (lock, unlock, climate, sentry, charge, frunk, trunk, horn, flash)"),
        chg(.added, "**Smart Insights Engine** — auto-generated recommendations from driving/charging data"),
        chg(.added, "**Drive Score** rating system (0-100 animated gauge)"),
        chg(.added, "**16 Grafana dashboards** with verified SQL queries"),
        chg(.added, "**Futuristic tire pressure visualization** with animated car SVG"),
        chg(.added, "**Smart charging optimizer** with cost comparison by charger type"),
        chg(.added, "**Monthly statistics tables** with inline spark bars"),
        chg(.added, "**Charging cost analytics** — cost per kWh tracking, location comparison"),
        chg(.added, "**State timeline bars** — Gantt-style vehicle state visualization"),
        chg(.added, "**Software update timeline** — version progression chart"),
        chg(.added, "**Projected range calculator** with weather/driving condition adjustments"),
        chg(.added, "**Vehicle comparison page** — side-by-side metrics with radar chart"),
        chg(.added, "**Total cost of ownership calculator** — EV vs gas comparison"),
        chg(.added, "**Trip planner** with range estimation and charging stop calculation"),
        chg(.added, "**PDF report generation** for drives and monthly summaries"),
        chg(.added, "**Global search** across vehicles, drives, locations in command palette"),
        chg(.added, "**Fleet efficiency leaderboard** with rankings"),
        chg(.added, "**Onboarding wizard** — 4-step first-time setup"),
        chg(.added, "**API key management** with HMAC-SHA256 authentication"),
        chg(.added, "**Inbound webhook API** for external system integration"),
        chg(.added, "**7-channel notifications** (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover)"),
        chg(.added, "**12 configurable alert types** with quiet hours and digest mode"),
        chg(.added, "**Data privacy controls** — anonymize locations, GDPR export"),
        chg(.added, "**Unit preferences** — km/mi, °C/°F applied across all pages"),
        chg(.changed, "**PostgreSQL 17** with native partitioning (replaced TimescaleDB)"),
        chg(.changed, "**Helm chart v0.3.0** — embedded/external services, IngressRoute, HPA, PDB"),
        chg(.changed, "**14 GitHub Actions workflows** — CI, Docker, security, quality, release"),
        chg(.changed, "**Tesla Fleet API billing optimization** — adaptive polling ($3/month vs $192)"),
        chg(.changed, "**Docker Compose** — 6 services (API, Web, PostgreSQL, Redis, MQTT, Grafana)"),
        chg(.changed, "**127 automated tests** (84 Go + 43 frontend)"),
        chg(.changed, "**E2E test suite** with 25+ endpoint checks"),
        chg(.changed, "**SBOM generation** + container image signing"),
        chg(.changed, "**Dependabot** for Go, npm, Docker, Actions dependencies"),
        chg(.changed, "**VitePress docs site** with Mermaid diagrams and automotive animations"),
        chg(.changed, "**54-endpoint API reference** with JSON examples"),
        chg(.changed, "**Complete database schema** documentation (21 tables)"),
        chg(.changed, "**Technology stack** rationale"),
        chg(.changed, "**Troubleshooting guide** + FAQ"),
        chg(.changed, "**Roadmap** with 4 release tiers"),
        chg(.security, "**CodeQL** SAST for Go + JavaScript"),
        chg(.security, "**govulncheck** for Go CVE scanning"),
        chg(.security, "**HMAC webhook signatures**"),
        chg(.security, "**API key auth middleware**"),
        chg(.security, "**Rate limiting** (100 req/min per IP)"),
        chg(.security, "**Security headers** (HSTS, CSP, X-Frame-Options)")
    ]

    /// Every release in the generated CHANGELOG, newest-first (web `CHANGELOG`).
    public static let all: [ChangelogReleaseEntry] = [
        rel("0.7.0", "2026-03-29", .latest, changes070),
        rel("0.6.0", "2026-03-28", .stable, changes060),
        rel("0.5.0", "2026-03-23", .stable, changes050),
        rel("0.4.0", "2026-03-23", .stable, changes040),
        rel("0.3.0", "2026-03-22", .stable, changes030),
        rel("0.1.0", "2026-03-21", .stable, changes010)
    ]
    // swiftlint:enable line_length

    /// The total number of catalogued releases (web `CHANGELOG.length`).
    public static var total: Int {
        all.count
    }

    /// The topmost version, e.g. "0.7.0" (web `LATEST_VERSION`).
    public static var latestVersion: String {
        all.first?.version ?? ""
    }

    /// Looks up a release by version string.
    public static func entry(for version: String) -> ChangelogReleaseEntry? {
        all.first { $0.version == version }
    }
}
