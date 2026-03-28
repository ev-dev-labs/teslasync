# Changelog

All notable changes to TeslaSync are documented here.

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
