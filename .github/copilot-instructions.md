# TeslaSync — Copilot Instructions

## Project Overview

TeslaSync is a **self-hosted Tesla Fleet Intelligence Platform** built with Go and React. It collects, analyzes, and visualizes data from Tesla vehicles via the Tesla Fleet API and optional Fleet Telemetry streaming. It provides real-time monitoring, 30+ interactive pages, remote vehicle commands, and 16 Grafana dashboards.

**Repository:** `github.com/ev-dev-labs/teslasync`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React SPA (Vite 5)  │  Grafana (16 dashboards)            │
└────────────┬─────────┴──────────────────┬───────────────────┘
             │                            │ SQL
┌────────────┴────────────────────────────┤                   │
│          Nginx (teslasync-web :80)      │                   │
│   Static files + reverse proxy /api/*   │                   │
└────────────┬────────────────────────────┘                   │
             │ proxy_pass                                     │
┌────────────┴────────────────────────────────────────────────┐
│              Go API Server (teslasync :8080)                │
│   Chi router · 28+ API handlers · SSE EventHub             │
│   Circuit breaker · Rate limiting · Prometheus /metrics     │
└────┬──────────┬──────────┬──────────┬───────────────────────┘
     │          │          │          │
  PostgreSQL  Redis 7   Mosquitto  Tesla Fleet API
   (PG 17)    Cache     MQTT 2
```

### Docker Compose Services (8 total)
| Service | Purpose | Port |
|---------|---------|------|
| `teslasync` | Go API server | 8080 |
| `web` | React SPA via Nginx | 3000 |
| `notification-worker` | Async MQTT notification processor | 8081 |
| `export-worker` | Data export processor | 8082 |
| `postgres` | PostgreSQL 17 database | 5432 |
| `redis` | Redis 7 cache | 6379 |
| `mosquitto` | Eclipse Mosquitto MQTT broker | 1883 |
| `grafana` | Grafana 10.4 dashboards | 3001 |
| `fleet-telemetry` | *(optional profile)* Tesla Fleet Telemetry server | 4443 |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Go 1.24 · Chi router · pgx/v5 · zerolog · gobreaker · go-redis/v9 · paho.mqtt |
| **Frontend** | React 18 · TypeScript 5.4 · Vite 5 · Tailwind CSS 3.4 · Recharts · Leaflet · Framer Motion · TanStack Query v5 |
| **Database** | PostgreSQL 17 (native partitioning for positions) · golang-migrate |
| **Cache** | Redis 7 (fallback to in-memory) |
| **Messaging** | MQTT via Eclipse Mosquitto 2 · paho.mqtt.golang |
| **Monitoring** | Grafana 10.4 · Prometheus client_golang |
| **Deployment** | Docker Compose · Helm 3 · GitHub Actions (6 workflows) |

## Project Structure

```
cmd/
  teslasync/          # Main API server entry point
  notification-worker/# MQTT notification processor
  export-worker/      # Data export processor
internal/
  api/                # HTTP handlers, router, middleware, SSE
  cache/              # Redis cache wrapper (fallback to in-memory)
  config/             # Environment-based configuration (config.Load())
  crypto/             # Encryption for tokens at rest
  database/           # pgx/v5 pool, 27 repository files, migrations
  events/             # Domain event bus (MQTT-backed)
  export/             # CSV/JSON data export logic
  models/             # Go structs with json + db tags
  mqtt/               # MQTT client wrapper (paho.mqtt)
  notification/       # 7-channel notification dispatch
  resilience/         # Circuit breaker, retry, health monitor
  tesla/              # Tesla Fleet API client with circuit breaker
  worker/             # Vehicle polling loop with adaptive sleep backoff
web/                  # React SPA (Vite + TypeScript + Tailwind)
migrations/           # PostgreSQL migrations (000001–000016)
grafana/              # Provisioning + 16 dashboard JSON files
helm/teslasync/       # Helm chart for Kubernetes deployment
docs/                 # VitePress documentation site
```

## Go Backend Conventions

### General
- **Go 1.24**, CGO_ENABLED=0 for static binaries
- **Logging:** zerolog only — never `fmt.Println` or `log.Println`
- **Errors:** Return errors, don't panic. Use `fmt.Errorf("context: %w", err)` for wrapping.
- **Timestamps:** Always `time.Now().UTC()`
- **Linting:** golangci-lint with errcheck, govet, staticcheck, unused, gosimple, ineffassign, typecheck

### Configuration
- All config via environment variables, loaded in `internal/config/config.Load()`
- Config struct: `config.Config` with nested `DatabaseConfig`, `TeslaConfig`, `MQTTConfig`, `RedisConfig`, `FleetTelemetryConfig`, etc.
- Database DSN format: `postgres://user:pass@host:port/name?sslmode=disable`

### HTTP Handlers
- **Router:** go-chi/chi/v5 with nested `r.Route()` groups
- **Handler pattern:** Struct-based with `NewXxxHandler(db, ...)` constructors
- **Functional options:** `WithDB()`, `WithConfig()`, `WithMQTTClient()` for optional dependencies
- **Response helpers:** `writeJSON(w, status, data)`, `writeError(w, status, msg)`
- **Middleware stack:** RequestID → RealIP → Logger → Recovery → Compress → CORS → SecurityHeaders → MaxBytesReader (1MB)
- **Rate limiting:** `httprate.LimitByIP(N, duration)` applied per-route with `r.With()`
- **API prefix:** All endpoints under `/api/v1/`

### Database
- **Driver:** pgx/v5 with connection pool (`pgxpool.Pool`)
- **Pool settings:** MaxConns=25, MinConns=5, HealthCheck=15s
- **Repository pattern:** One file per entity in `internal/database/` (e.g., `vehicle_repo.go`)
- **Queries:** Parameterized only (`$1`, `$2`, ...) — never string interpolation
- **Not-found convention:** Return `(nil, nil)` when `pgx.ErrNoRows`, not an error
- **Row scanning:** Always `rows.Scan(&field1, &field2, ...)` with `defer rows.Close()`
- **Migrations:** `golang-migrate/migrate/v4`, files named `000NNN_description.{up,down}.sql`

### Tesla API Client
- Located in `internal/tesla/client.go`
- **Circuit breaker:** gobreaker with 10 consecutive failures to open, 60s timeout
- **Rate limiter:** 10 req/sec with burst=5
- **Token management:** Thread-safe with `sync.RWMutex`
- **API logging:** Callback-based, logs method/url/status/duration/body to `api_call_logs` table
- **Commands:** Map-based dispatch (`commandMap`) for 14 vehicle commands

### MQTT
- **Client:** `internal/mqtt/Client` wrapping `paho.mqtt.golang`
- **Topic format:** `{prefix}/{vin}/{metric}` (default prefix: `teslasync`)
- **QoS:** 0 (at most once), Retain: true
- **Auto-reconnect:** Enabled with 60s max interval
- **Publishing:** `Publish(topic, payload)` and `PublishJSON(topic, obj)` methods

### Resilience Patterns
- **ConnectWithRetry:** Retry loop for DB/MQTT connections with backoff
- **SafeGoLoop:** Goroutine wrapper that recovers from panics and restarts
- **HealthMonitor:** Component health tracking with 60s watchdog tick
- **Graceful shutdown:** Signal handler → cancel context → drain connections (30s timeout)

## React Frontend Conventions

- **React 18** with functional components and hooks only (no class components)
- **TypeScript strict mode** — all props and state typed
- **Vite 5** for bundling, `tsc && vite build` for production
- **Tailwind CSS 3.4** with glassmorphism design (frosted glass panels, neon accents)
- **5 color themes** via CSS custom properties — Neon Cyan, Tesla Red, Matrix Green, Royal Purple, Solar Amber
- **Code-splitting** with `React.lazy()` for all route-level components
- **API client** centralized in `web/src/api.ts` — typed `request<T>()` wrapper with resilient fetch
- **State management:** TanStack Query v5 for async state + caching
- **Routing:** react-router-dom v6 with nested routes
- **Charts:** Recharts for data visualization
- **Maps:** react-leaflet + Leaflet for GPS visualization
- **Animations:** Framer Motion
- **Icons:** lucide-react
- **i18n:** i18next + react-i18next
- **PWA:** vite-plugin-pwa with service worker

## Model Conventions

Go struct tags use both `json` and `db` tags:
```go
type Vehicle struct {
    ID          int64     `json:"id" db:"id"`
    VIN         string    `json:"vin" db:"vin"`
    DisplayName string    `json:"display_name" db:"display_name"`
    State       string    `json:"state" db:"state"`
    CreatedAt   time.Time `json:"created_at" db:"created_at"`
}
```
- Nullable fields use pointers: `*float64`, `*int`, `*string`, `*time.Time`
- Sensitive fields use `json:"-"` to exclude from API responses
- Optional JSON fields use `json:"field,omitempty"`

## Fleet Telemetry Integration

TeslaSync integrates with Tesla's [fleet-telemetry](https://github.com/teslamotors/fleet-telemetry) server:
- **Config:** `fleet-telemetry-config.json` dispatches vehicle data to `POST /api/v1/telemetry`
- **Docker:** Optional `--profile telemetry` enables the Fleet Telemetry sidecar
- **Ingestion handler:** `internal/api/telemetry_handler.go` — parses signals, stores positions, publishes to MQTT
- **Session tracking:** Auto-detects drive/charge sessions from telemetry stream
- **Public key:** Auto-served at `/.well-known/appspecific/com.tesla.3p.public-key.pem`
- **Key management:** Generate/upload ECDSA P-256 keys via Dev Tools UI, stored in `tesla_public_key` table

## Environment Configuration

All settings via `.env` file (see `.env.example`). Key variables:
- `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET` — Tesla API credentials
- `TESLA_API_BASE_URL` — Regional Fleet API endpoint (NA/EU/CN)
- `POSTGRES_*` — Database connection
- `MQTT_*` — MQTT broker settings
- `REDIS_*` — Redis cache settings
- `FLEET_TELEMETRY_*` — Optional Fleet Telemetry server settings
- `LOG_LEVEL` — trace, debug, info, warn, error

## Testing

- **Go:** `go test -race -coverprofile=coverage.out ./...`
- **Lint:** `golangci-lint run ./...`
- **Frontend:** `cd web && npm run lint` (ESLint), `npm test` (Vitest)
- **All checks:** `make check` runs lint + test + vet
