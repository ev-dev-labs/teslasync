<p align="center">
  <img src="web/public/icons/icon-192.svg" width="80" height="80" alt="TeslaSync" />
</p>

<h1 align="center">TeslaSync</h1>

<p align="center">
  <strong>Tesla Fleet Intelligence Platform</strong><br>
  Self-hosted real-time monitoring, advanced analytics, and remote control for your Tesla vehicles.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#api">API</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white" alt="Go 1.22" />
  <img src="https://img.shields.io/badge/tests-14%20packages-success" alt="Tests" />
  <img src="https://img.shields.io/badge/coverage-race%20enabled-blue" alt="Coverage" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## Overview

TeslaSync is a self-hosted platform for collecting, analyzing, and visualizing data from your Tesla fleet. Built from the ground up with **Go** and **React**, it delivers a modern glassmorphism UI, real-time streaming, multi-theme support, and enterprise-grade observability — all running on your own infrastructure.

### Highlights

- **Lightweight** — Go backend with ~30 MB memory footprint and efficient connection pooling
- **61 interactive pages** — Dashboard, live map, drives, charging, energy, battery health, analytics, backup & restore, and more
- **5 dynamic themes** — Neon Cyan, Tesla Red, Matrix Green, Royal Purple, Solar Amber (each with 4 display modes)
- **Real-time SSE streaming** — Instant vehicle updates pushed to connected browsers
- **14 remote commands** — Lock, unlock, climate, sentry, charge, frunk, trunk, horn, flash, and more
- **Smart Insights** — Auto-generated data analysis with actionable recommendations
- **26 Grafana dashboards** — Pre-built dashboards for deep analytics
- **231 Tesla fleet telemetry fields** — 100% Tesla Fleet Telemetry Protocol coverage (all signals from `vehicle_data.proto` subscribed AND processed)
- **Helm chart** — Production-ready Kubernetes deployment with external service support
- **Complete CI/CD** — 14 GitHub Actions workflows for build, test, security, and release
- **25 Developer Tools** — Built-in Tesla API diagnostics, VIN decoder, JWT decoder, partner registration, and 20+ utilities

## Features

### 🚗 Real-Time Fleet Intelligence
- **Live Dashboard** — Battery, range, location, climate, and charging status at a glance
- **Live Map** — Track all vehicles with real-time GPS position updates and animated markers
- **SSE Streaming** — Server-Sent Events push vehicle updates and alerts instantly
- **Vehicle State Timeline** — Visual history of driving, charging, sleeping, and online states

### 📊 Advanced Analytics & Visualization
- **Energy Analytics** — Consumption patterns, efficiency scoring, cost tracking
- **Battery Health** — Degradation monitoring, charge cycle estimation, capacity projection
- **Drive Analytics** — Distance, speed, efficiency trends with detailed per-drive breakdowns
- **Charging Intelligence** — Session analysis, cost per kWh tracking, charger type breakdown
- **Monthly Statistics** — Rich data tables with inline spark bars for period-over-period analysis
- **Projected Range** — Range prediction under different conditions (highway, city, cold, hot, sentry)
- **Vampire Drain** — Idle battery drain analysis with sentry mode correlation
- **Fleet Comparison** — Side-by-side vehicle metrics, utilization, and cost allocation
- **Smart Insights Engine** — Auto-generated insights from driving and charging patterns
- 🏎️ **Driving Dynamics** — Motor torque, G-forces, acceleration patterns, pedal usage, stator temperature
- 🌡️ **Climate Control** — HVAC power & fan speed, thermal comfort scoring, cabin/outside temperature trends
- ⚡ **Charging Curve** — Charge rate vs SOC% visualization, session comparison, charging speed degradation
- 💰 **Cost Analysis** — Monthly cost trends, gas vs electric savings calculator, cost per mile, lifetime savings
- 🔋 **Battery Cells** — Cell voltage spread, module temperature balance, 4×23 pack visualization, degradation correlation
- 🏆 **Drive Score** — Gamified 0-100 efficiency scoring, smoothness/speed breakdown, improvement tips
- 📊 **Weekly Digest** — Auto-generated weekly car summary with highlights, fun facts, week-over-week comparison
- 🔧 **Maintenance** — Service schedule tracker with odometer-based progress bars, service log, cost estimates
- 📦 **Data Export** — Export drives, charging, positions in CSV/JSON format with job management
- ⚡ **Energy Flow** — Pack voltage/current, cell balance, module temps, BMS status, powershare
- 🔩 **Drivetrain Health** — Quad-motor thermal monitoring, stator/heatsink/inverter temps
- 🎵 **Media Player** — Now playing, volume, playback history, source distribution
- 🛡️ **Safety Settings** — ADAS configuration, collision warnings, FSD statistics
- 🗺️ **Navigation** — Active route, destination, home/work/favorite indicators

### 🧠 Cross-Table Intelligence (NEW)
- 💰 **True Cost of Ownership** — EV vs gas cumulative savings calculator with monthly breakdown
- 🛏️ **Sleep Efficiency** — Vehicle state distribution, time-to-sleep, sentry mode cost analysis
- 🔥 **Charging Heatmap** — 7×24 grid of charging patterns (when × where × how much)
- 🏎️ **Speed Profile** — Speed distribution histogram, efficiency vs speed scatter, optimization insights
- 🌡️ **Temperature Impact** — Efficiency vs temperature curve, winter/summer penalty quantification
- 🛣️ **Route Efficiency** — Same-route comparison across trips with weather/speed correlation
- ♻️ **Regen Braking** — Regenerative energy capture ratio, per-drive scoring, monthly trends
- 📉 **Battery Degradation** — Health trend with linear regression projection, risk factor analysis

### 🎮 Remote Vehicle Control
- Wake / Lock / Unlock
- Climate On/Off
- Sentry Mode toggle
- Charge Port / Start / Stop Charging
- Frunk / Trunk Open
- Horn / Flash Lights
- Speed Limit toggle

### 🔒 Security & Access
- Lock status, sentry mode, door/window state visualization, event timeline

### 💾 Backup & Restore
- Scheduled automated backups (daily to every 30 days)
- Full and incremental backup types
- Multi-provider storage: Local, Amazon S3, Azure Blob, Google Cloud Storage
- Configurable retention (keep last N backups, max 100)
- Gzip compression + SHA-256 integrity verification
- Download, verify, and preview restore from UI
- Complete run history with status tracking
- Manual quick backup via one click

### 🗺️ Maps & Geocoding
- **Multi-provider map tiles** — auto-selects based on configured API key:
  - 🌐 **CARTO Dark** (default, free, no key needed)
  - 📍 **Azure Maps** (dark, road, satellite — 250K free/month)
  - 🔵 **Google Maps** (road, satellite, terrain — 100K free/month)
  - Free fallbacks: Esri Satellite, OpenStreetMap, OpenTopoMap
- **Layer switcher** on all 5 map pages (Dark / Satellite / Streets / Terrain)
- **Geocoding priority**: Geofence name → Places cache → Google/Azure/Nominatim
- **Places cache** — resolved locations stored locally for ~90% API call reduction
- **Reverse geocoding** — drives and charging sessions auto-resolve to place names

### 🔭 Distributed Tracing (Optional)
- OpenTelemetry instrumentation with OTLP gRPC export
- Per-repo DB spans with semantic conventions (table, operation, entity IDs)
- Handler-level spans with custom vehicle/drive attributes
- Transaction tracing with error recording
- Jaeger integration (Docker Compose profile + Helm chart)
- Zero overhead when disabled (noop provider)

### 🎨 Modern UX
- **Glassmorphism Design** — Frosted glass panels, neon accents, smooth animations
- **5 Color Themes** — Dynamic theme switching with CSS variables
- **Map Layer Switcher** — Dark, Satellite, Streets, Terrain on all map pages
- **Command Palette** — `Cmd+K` / `Ctrl+K` for instant navigation across all 61 pages
- **Animated Car SVG** — Subtle automobile animations on loading states and docs
- **Code-Split Routes** — Lightning-fast page loads with React lazy loading
- **PWA-Ready** — Installable as a native app with custom splash screen
- **Error Boundaries** — Graceful error recovery without full page crashes
- **Responsive** — Works on desktop, tablet, and mobile

### 🔒 Enterprise-Grade Backend
- **Go 1.22** — Fast, concurrent, minimal memory footprint
- **Circuit Breaker** — Automatic Tesla API backoff with gobreaker
- **Rate Limiting** — Configurable per-IP rate limiting
- **Prometheus Metrics** — `/metrics` endpoint for monitoring
- **Structured Logging** — JSON logs via zerolog
- **PostgreSQL 17** — Natively partitioned tables for position data, 23 schema migrations, DBTX transaction support for critical paths, [interactive database diagram](https://teslasync-labs.github.io/teslasync/guide/architecture) in docs
  - `motor_snapshots` — Drivetrain telemetry (torque, RPM, G-forces, pedal position)
  - `climate_snapshots` — HVAC telemetry (temps, fan speed, power, defrost)
  - `security_events` — Security state (locks, sentry, doors, windows)
  - `charging_telemetry` — 55-column real-time charging data (pack voltage/current, cell voltages, BMS, powershare)
  - `media_snapshots` — Now playing, volume, playback source
  - `vehicle_config_snapshots` — Trim, color, software updates
  - `location_snapshots` — Navigation destination, route, home/work/favorite detection
  - `safety_snapshots` — ADAS settings, collision warnings, FSD miles
  - `user_preference_snapshots` — Unit settings, time format
- **MQTT Publishing** — Real-time vehicle telemetry to any MQTT subscriber
- **MQTT Workers** — Notification worker + export worker for async processing
- **Redis Caching** — Fast lookups for vehicle state and sessions
- **7-Channel Notifications** — Discord, Slack, Telegram, Email, Webhooks, ntfy, Pushover
- **Adaptive Sleep Backoff** — Exponential backoff for asleep vehicles (60s → 10 min cap) to minimize wasted API calls
- **API Suspend Toggle** — Suspend all Tesla Fleet API calls from Settings UI or API when vehicle is in service
- **Granular Endpoint Controls** — Enable/disable individual Tesla Fleet API endpoints for both automatic polling and on-demand calls (20 independent toggles across polling, on-demand, and commands)

### 🛠 Developer Tools
- **Tesla Fleet API** — Region detection, partner registration, API connectivity test, token inspector
- **Public Key Management** — Generate ECDSA P-256 keypairs, auto-serve at `.well-known` path, upload existing keys
- **Infrastructure Diagnostics** — Database stats, migration status, MQTT connectivity test, environment check
- **Client-Side Utilities** — VIN decoder, JWT decoder, JSON formatter, UUID generator, regex tester, and more
- **Fleet Telemetry** — Status monitoring, 231 signals with 100% Tesla protocol coverage across all categories, enable/disable visibility in system status
- **Vehicle Data Queries** — Fleet telemetry errors table with download, vehicle data queries tool
- **Tesla Fleet API** — Nearby charging sites, release notes, recent alerts, service data

## Architecture

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                        CLIENT LAYER                             │
 │                                                                  │
 │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
 │  │  React SPA   │  │  PWA Shell   │  │  Grafana Dashboards  │  │
 │  │  (Vite 5)    │  │  (manifest)  │  │  (26 dashboards)     │  │
 │  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
 └─────────┼─────────────────┼─────────────────────┼──────────────┘
           │                 │                     │ SQL
 ┌─────────┴─────────────────┴─────────────────────┤              │
 │                   INGRESS LAYER                  │              │
 │         (Traefik / Nginx Ingress Controller)     │              │
 └──────────────────────┬──────────────────────────┘              │
                        │ single route (all traffic)              │
 ┌──────────────────────┴──────────────────────────────────────────┐
 │                     WEB LAYER (Nginx)                           │
 │                                                                  │
 │  ┌────────────────────────────────────────────────────────────┐ │
 │  │              teslasync-web (Nginx :80)                     │ │
 │  │  ┌─────────────────┐  ┌────────────────────────────────┐  │ │
 │  │  │  Static Files   │  │  Reverse Proxy (internal k8s)  │  │ │
 │  │  │  /index.html    │  │  /api/*  → teslasync-api:8080  │  │ │
 │  │  │  /assets/*      │  │  /.well-known/* → api:8080     │  │ │
 │  │  │  (served direct)│  │  /healthz,/readyz → api:8080   │  │ │
 │  │  └─────────────────┘  │  /metrics → api:8080           │  │ │
 │  │                       └────────────────────────────────┘  │ │
 │  └────────────────────────────────────────────────────────────┘ │
 └──────────────────────────────┬───────────────────────────────────┘
                                │ proxy_pass (cluster-internal)
 ┌──────────────────────────────┴──────────────────────────────────┐
 │                        API LAYER                                │
 │                                                                  │
 │  ┌──────────────────────────────────────────────────────────┐  │
 │  │                   Go API Server (:8080)                   │  │
 │  │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ │  │
 │  │  │  Router   │ │ Handlers │ │ Middleware  │ │   SSE    │ │  │
 │  │  │  (chi)    │ │ (28 API) │ │(rate/CORS) │ │EventHub  │ │  │
 │  │  └──────────┘ └──────────┘ └────────────┘ └──────────┘ │  │
 │  │  ┌──────────┐ ┌──────────┐ ┌────────────┐              │  │
 │  │  │ Circuit  │ │  Worker  │ │ Prometheus  │              │  │
 │  │  │ Breaker  │ │  Poller  │ │  Metrics    │              │  │
 │  │  └──────────┘ └──────────┘ └────────────┘              │  │
 │  └──────────────────────────────────────────────────────────┘  │
 └────────┬──────────────┬──────────────┬──────────────┬──────────┘
          │              │              │              │
 ┌────────┴────┐ ┌───────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
 │ PostgreSQL  │ │   Redis 7   │ │ Mosquitto  │ │   Tesla   │
 │ (PG 17)     │ │   Cache     │ │ MQTT 2     │ │ Fleet API │
 └─────────────┘ └─────────────┘ └───────────┘ └───────────┘
```

> **Traffic Flow:** In Kubernetes, all external traffic enters through a single ingress route pointing to `teslasync-web` (Nginx). Nginx serves static files directly and proxies API paths (`/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, `/metrics`) to `teslasync-api` over the internal Kubernetes network. API traffic never traverses the ingress controller — only the initial page load does.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Go 1.22 · Chi router · pgx/v5 · zerolog · gobreaker |
| **Frontend** | React 18 · TypeScript · Vite 5 · Tailwind CSS · Recharts · Leaflet · Framer Motion |
| **Database** | PostgreSQL 17 with native partitioning |
| **Cache** | Redis 7 |
| **Messaging** | MQTT (Mosquitto 2) |
| **Monitoring** | Grafana 10.4 · Prometheus · OpenTelemetry (optional Jaeger) |
| **Deployment** | Docker Compose · Helm 3 · GitHub Actions |

### Key Packages

```
internal/
├── api/            # HTTP handlers, router, SSE, middleware
├── backup/         # Scheduled & manual backup engine, multi-provider storage
├── cache/          # Redis caching layer
├── config/         # Environment + YAML configuration
├── crypto/         # ECDSA key management
├── database/       # PostgreSQL queries, DBTX transactions, places cache, 24 migrations
├── events/         # SSE event hub
├── export/         # CSV/JSON export engine
├── geocoding/      # Multi-provider reverse geocoding (Google, Azure, Nominatim)
├── models/         # Domain models
├── mqtt/           # MQTT publisher
├── notification/   # 7-channel notification dispatch
├── resilience/     # Circuit breaker, rate limiter
├── tesla/          # Tesla Fleet API client
├── tracing/        # OpenTelemetry instrumentation (OTLP gRPC, Jaeger)
└── worker/         # Background pollers, MQTT workers
```

## Quick Start

### Prerequisites

- Docker and Docker Compose v2+
- Tesla Developer API credentials ([developer.tesla.com](https://developer.tesla.com/))

### 1. Clone & Configure

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
# Edit .env with your TESLA_CLIENT_ID and TESLA_CLIENT_SECRET
```

### 2. Launch

```bash
docker compose up -d
```

This starts 8 services: Go API server, React web UI, notification worker, export worker, PostgreSQL 17, Redis, MQTT, and Grafana.

### 3. Access

| Service | URL |
|---------|-----|
| **Web UI** | http://localhost:3000 |
| **API** | http://localhost:8080 |
| **Grafana** | http://localhost:3001 |
| **MQTT** | localhost:1883 |

### 4. Connect Your Tesla

Navigate to **Settings** in the web UI and connect your Tesla account via OAuth2. Vehicles sync automatically.

### 5. Optional Configuration

| Feature | Environment Variable | Description |
|---------|---------------------|-------------|
| **OpenTelemetry** | `OTEL_ENABLED=true` | Enable distributed tracing (OTLP gRPC export) |
| **Jaeger UI** | `docker compose --profile jaeger up -d` | Start Jaeger for trace visualization |
| **Backup** | Configure via **Settings → Backup & Restore** in the web UI | Schedule, storage provider, retention policy |

## Grafana Dashboards

TeslaSync ships with **26 pre-built Grafana dashboards**:

| Dashboard | Description |
|-----------|-------------|
| Vehicle Overview | Battery, range, speed, temperature, odometer |
| Fleet Overview | Cross-vehicle comparison, fleet totals |
| Charging | Session stats, energy added, charger analysis |
| Charging Stats | Cost tracking, cost per kWh trends |
| Drives | Distance, speed, efficiency, drive history |
| Efficiency | Wh/km patterns, temperature correlation |
| Battery Health | Degradation trend, capacity, charge cycles |
| Vampire Drain | Parasitic drain analysis, sentry mode impact |
| Mileage | Daily/monthly distance, drive count |
| Tire Pressure | Per-tire PSI tracking and trends |
| Software Updates | OTA version history and timeline |
| Timeline | Vehicle state transitions over time |
| Locations | Visited places, frequency, duration |
| Trips | Multi-drive journey tracking |
| Statistics | Long-term averages, totals, best/worst |
| Projected Range | Range prediction and degradation forecast |
| Motor / Powertrain | Motor torque, axle speed, G-forces, pedal position |
| Climate / HVAC | Cabin/outside temps, HVAC power, fan speed, defrost |
| Security / Access | Lock state, sentry mode, doors, windows, HomeLink |
| Tire Pressure Detail | Per-tire trends, balance scoring, alert thresholds |
| Fleet Health | Multi-vehicle health comparison, utilization, cost |
| API Usage | Request counts, cost tracking, rate limit monitoring |
| Energy Flow | Pack voltage/current, charging power, cell spread, BMS |
| Drivetrain Thermal | Stator/heatsink/inverter temps, motor currents |
| Comfort & Media | Seat heaters, HVAC modes, now playing, volume |
| Vehicle Intelligence | Config, software, safety, navigation, preferences |

## Development

### Backend

```bash
go mod download        # Install dependencies
make run               # Run locally (needs Postgres, Redis, MQTT)
make test              # Run tests with coverage
make lint              # golangci-lint
```

- **14 Go test packages** covering API, cache, config, crypto, database, events, export, geocoding, models, MQTT, notification, resilience, Tesla client, and worker
- **Race condition detection** enabled in CI (`go test -race`)
- **Migration rollback testing** — all 23 up/down migrations verified in CI

### Frontend

```bash
cd web
npm install            # Install dependencies
npm run dev            # Dev server at :3000 (proxies API to :8080)
npm run build          # Production build
npm run lint           # ESLint
```

- **41 frontend tests** with Vitest

### Docker

```bash
docker compose up -d          # Start all 8 services
docker compose logs -f        # Tail logs
docker compose down           # Stop everything
docker compose build          # Rebuild images
```

## Deployment

### Docker Compose (Recommended)

```bash
docker compose up -d --build
```

### Kubernetes (Helm)

```bash
helm install teslasync ./helm/teslasync \
  --set tesla.clientId=$TESLA_CLIENT_ID \
  --set tesla.clientSecret=$TESLA_CLIENT_SECRET \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=teslasync.example.com
```

The Helm chart uses a **single ingress route** pointing all traffic to `teslasync-web` (Nginx). Nginx serves the React SPA and proxies API requests (`/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, `/metrics`) to `teslasync-api` over the internal Kubernetes network — no separate `/api` ingress path is needed. The chart supports embedded or external services (PostgreSQL, Redis, MQTT, Grafana), Traefik IngressRoute, HPA, PDB, and helm test. See [helm/teslasync/README.md](helm/teslasync/README.md) for full documentation.

## API

### Core

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Liveness probe |
| GET | `/readyz` | Readiness probe |
| GET | `/metrics` | Prometheus metrics |
| GET | `/api/v1/events` | SSE real-time event stream |
| GET | `/api/v1/export/{type}` | Export data (CSV/JSON) — synchronous |
| POST | `/api/v1/export/jobs` | Submit async export job |
| GET | `/api/v1/export/jobs` | List export jobs |
| GET | `/api/v1/export/jobs/:id` | Get export job status |
| GET | `/api/v1/export/jobs/:id/download` | Download completed export |
| POST | `/api/v1/export/jobs/import` | Submit async CSV import job |

### Vehicles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/vehicles` | List vehicles |
| POST | `/api/v1/vehicles/sync` | Sync from Tesla |
| GET | `/api/v1/vehicles/:id/state` | Live state |
| GET | `/api/v1/vehicles/:id/positions` | Position history |
| POST | `/api/v1/vehicles/:id/command` | Send command |

### Data & Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/drives` | Drive history |
| GET | `/api/v1/charging` | Charging sessions |
| GET | `/api/v1/analytics/fleet` | Fleet analytics |
| GET | `/api/v1/energy/stats` | Energy statistics |
| GET | `/api/v1/battery/report` | Battery health report |
| GET | `/api/v1/mileage/daily` | Daily mileage |
| GET | `/api/v1/mileage/monthly` | Monthly mileage |
| GET | `/api/v1/timeline` | Vehicle state timeline |
| GET | `/api/v1/locations` | Visited locations |
| GET | `/api/v1/vampire-drain/events` | Vampire drain events |
| GET | `/api/v1/motor` | Motor/drivetrain telemetry |
| GET | `/api/v1/climate` | Climate/HVAC telemetry |
| GET | `/api/v1/security` | Security state & events |
| GET | `/api/v1/charging-telemetry` | Charging telemetry (pack, cells, BMS) |
| GET | `/api/v1/media` | Media snapshots |
| GET | `/api/v1/vehicle-config` | Vehicle config snapshots |
| GET | `/api/v1/location-snapshots` | Location/navigation snapshots |
| GET | `/api/v1/safety` | Safety/ADAS snapshots |
| GET | `/api/v1/user-preferences` | User preference snapshots |
| GET | `/api/v1/drives/:id/positions` | Drive route positions |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/notifications` | List channels |
| POST | `/api/v1/notifications` | Create channel |
| POST | `/api/v1/notifications/:id/test` | Test channel |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/settings/suspend-api` | Suspend or resume all Tesla API calls (`{"suspended": true/false}`) |
| GET | `/api/v1/settings/polling-config` | Get granular endpoint polling configuration (per-endpoint on/off toggles) |
| PUT | `/api/v1/settings/polling-config` | Update endpoint polling configuration |

### Developer Tools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dev-tools/fleet-api-info` | Fleet API configuration |
| GET | `/api/v1/dev-tools/detect-region` | Detect account region |
| POST | `/api/v1/dev-tools/register-partner` | Register partner account |
| GET | `/api/v1/dev-tools/test-api` | Test API connectivity |
| GET | `/api/v1/dev-tools/token-info` | Token validity info |
| GET | `/api/v1/dev-tools/db-stats` | Database statistics |
| GET | `/api/v1/dev-tools/migration-status` | Migration version |
| POST | `/api/v1/dev-tools/mqtt-test` | Test MQTT connectivity |
| GET | `/api/v1/dev-tools/env-check` | Environment variable check |
| GET | `/api/v1/dev-tools/runtime-info` | Go runtime information |
| POST | `/api/v1/dev-tools/generate-keypair` | Generate ECDSA P-256 keypair |
| POST | `/api/v1/dev-tools/upload-public-key` | Upload existing public key |
| GET | `/api/v1/dev-tools/public-key-status` | Public key configuration status |
| DELETE | `/api/v1/dev-tools/public-key` | Remove stored public key |
| GET | `/api/v1/dev-tools/nearby-charging` | Nearby Superchargers via Tesla API |
| GET | `/api/v1/dev-tools/release-notes` | Firmware release notes via Tesla API |
| GET | `/api/v1/dev-tools/recent-alerts` | Vehicle alerts from Tesla API |
| GET | `/api/v1/dev-tools/service-data` | Service history via Tesla API |
| POST | `/api/v1/auth/disconnect` | Disconnect Tesla account (clear tokens) |
| GET | `/.well-known/appspecific/com.tesla.3p.public-key.pem` | Serve Tesla public key |

## MQTT Topics

Vehicle telemetry is published to `teslasync/vehicles/{vin}/`:

```
teslasync/vehicles/{vin}/battery_level      # 0-100
teslasync/vehicles/{vin}/rated_range        # km
teslasync/vehicles/{vin}/latitude           # GPS lat
teslasync/vehicles/{vin}/longitude          # GPS lon
teslasync/vehicles/{vin}/speed              # km/h
teslasync/vehicles/{vin}/power              # kW
teslasync/vehicles/{vin}/inside_temp        # °C
teslasync/vehicles/{vin}/outside_temp       # °C
teslasync/vehicles/{vin}/sentry_mode        # bool
teslasync/vehicles/{vin}/is_charging        # bool
teslasync/vehicles/{vin}/vehicle_data       # full JSON
```

## Documentation

Full documentation is available at the [TeslaSync Docs](https://teslasync-labs.github.io/teslasync/) site, covering:

- [Getting Started](https://teslasync-labs.github.io/teslasync/guide/getting-started)
- [Architecture & Diagrams](https://teslasync-labs.github.io/teslasync/guide/architecture)
- [Configuration](https://teslasync-labs.github.io/teslasync/guide/configuration)
- [Technology Stack](https://teslasync-labs.github.io/teslasync/guide/technology)
- [Troubleshooting](https://teslasync-labs.github.io/teslasync/guide/troubleshooting)
- [FAQ](https://teslasync-labs.github.io/teslasync/guide/faq)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

Please see [SECURITY.md](.github/SECURITY.md) for vulnerability reporting.

## License

MIT
