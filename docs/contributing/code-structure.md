# Code Structure

This guide explains how the TeslaSync codebase is organized, making it easier to navigate, understand, and contribute.

## Repository Layout

```
TeslaSync/
├── cmd/teslasync/             # Application entry point
│   ├── main.go                # Bootstrap: config, DB, MQTT, worker, router, server
│   └── version.go             # Version info (injected at build via ldflags)
│
├── internal/                  # Private application packages
│   ├── api/                   # HTTP layer (handlers + middleware)
│   ├── config/                # Environment-based configuration
│   ├── database/              # Data access layer (repositories)
│   ├── models/                # Domain models and types
│   ├── mqtt/                  # MQTT telemetry publisher
│   ├── resilience/            # Circuit breaker, health checks
│   ├── tesla/                 # Tesla Fleet API client
│   └── worker/                # Background polling jobs
│
├── web/                       # React frontend
│   ├── src/
│   │   ├── pages/             # 25+ route pages (lazy-loaded)
│   │   ├── components/        # Reusable UI components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── api.ts             # Typed REST API client
│   │   ├── App.tsx            # Router configuration
│   │   ├── main.tsx           # React entry point
│   │   └── index.css          # Tailwind + custom styles
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── nginx.conf             # Production Nginx config
│
├── migrations/                # SQL migration files (golang-migrate)
│   ├── 000001_initial.up.sql
│   ├── 000001_initial.down.sql
│   ├── 000002_alerts_commands_energy.up.sql
│   ├── ...
│
├── helm/teslasync/            # Kubernetes Helm chart
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│
├── grafana/                   # Pre-built Grafana dashboards
│   ├── provisioning/
│   └── dashboards/
│
├── .github/workflows/         # CI/CD pipelines
│   ├── ci.yml                 # Lint, test, build
│   ├── docker.yml             # Docker image builds
│   ├── release.yml            # GoReleaser
│   └── docs.yml               # Documentation deployment
│
├── docker-compose.yml         # 6-service orchestration
├── Dockerfile                 # Backend multi-stage build
├── Dockerfile.web             # Frontend multi-stage build
├── Makefile                   # 20+ development targets
├── .env.example               # Environment variable template
├── .goreleaser.yml            # Release automation config
├── mosquitto.conf             # MQTT broker configuration
├── go.mod / go.sum            # Go dependencies
└── README.md                  # Project overview
```

## Backend Architecture

### Entry Point (`cmd/teslasync/main.go`)

The `main.go` file bootstraps all components in this order:

1. Load configuration from environment variables
2. Initialize zerolog structured logger
3. Set up health monitor with 4 tracked components
4. Connect to PostgreSQL with retry and run migrations
5. Connect to MQTT broker (optional — degrades gracefully)
6. Initialize Tesla API client with circuit breaker
7. Start worker goroutines (polling, maintenance, health watchdog)
8. Create the Chi HTTP router with all routes and middleware
9. Start the HTTP server with graceful shutdown handling

### API Layer (`internal/api/`)

Each domain has its own handler file:

| File | Handler Struct | Responsibility |
|------|---------------|----------------|
| `router.go` | — | Route definitions, middleware chain |
| `vehicle_handler.go` | `VehicleHandler` | Vehicle CRUD, positions, state, wake |
| `drive_handler.go` | `DriveHandler` | Drive history listing, detail |
| `charging_handler.go` | `ChargingHandler` | Charging session history |
| `geofence_handler.go` | `GeofenceHandler` | Geofence CRUD |
| `alert_handler.go` | `AlertHandler` | Alert listing, rules, mark-read |
| `command_handler.go` | `CommandHandler` | Remote vehicle commands |
| `energy_handler.go` | `EnergyHandler` | Energy consumption stats |
| `battery_handler.go` | `BatteryHandler` | Battery health reports |
| `analytics_handler.go` | `AnalyticsHandler` | Fleet-wide analytics |
| `notification_handler.go` | `NotificationHandler` | Notification channels, logs |
| `chatbot_handler.go` | `ChatbotHandler` | AI chat interface |
| `tire_pressure_handler.go` | `TirePressureHandler` | Tire pressure data |
| `software_update_handler.go` | `SoftwareUpdateHandler` | Software version tracking |
| `vampire_drain_handler.go` | `VampireDrainHandler` | Standby drain analysis |
| `visited_location_handler.go` | `VisitedLocationHandler` | Location visit history |
| `mileage_handler.go` | `MileageHandler` | Daily/monthly mileage |
| `trip_handler.go` | `TripHandler` | Multi-drive trips |
| `vehicle_state_handler.go` | `VehicleStateHandler` | State timeline |
| `auth_handler.go` | `AuthHandler` | OAuth2 flow |
| `sse_handler.go` | — | Server-Sent Events streaming |
| `export_handler.go` | — | CSV/JSON data export |
| `health.go` | — | Health, readiness, system status |
| `middleware.go` | — | Logging, recovery, security |
| `security.go` | — | Auth, CORS configuration |
| `helpers.go` | — | JSON response utilities |

**Handler pattern:**

```go
type VehicleHandler struct {
    db *database.DB
    tc *tesla.Client
}

func (h *VehicleHandler) List(w http.ResponseWriter, r *http.Request) {
    vehicles, err := h.db.ListVehicles(r.Context())
    if err != nil {
        respondError(w, http.StatusInternalServerError, err.Error())
        return
    }
    respondJSON(w, http.StatusOK, vehicles)
}
```

### Data Access Layer (`internal/database/`)

Each domain entity has its own repository file:

| File | Repository Methods |
|------|-------------------|
| `database.go` | Connection pool setup, health checks |
| `migrate.go` | Migration runner using golang-migrate |
| `vehicle_repo.go` | `ListVehicles`, `GetVehicle`, `UpsertVehicle`, `DeleteVehicle` |
| `position_repo.go` | `InsertPosition`, `GetPositions` (time-range queries) |
| `drive_repo.go` | `ListDrives`, `GetDrive`, `InsertDrive`, `UpdateDrive` |
| `charging_repo.go` | `ListChargingSessions`, `GetChargingSession`, `InsertSession` |
| `geofence_repo.go` | `ListGeofences`, `CreateGeofence`, `UpdateGeofence`, `DeleteGeofence` |
| `alert_repo.go` | `ListAlerts`, `InsertAlert`, `MarkAlertRead`, `ListRules`, `UpdateRule` |
| `settings_repo.go` | `GetSettings`, `UpdateSettings` |
| `token_repo.go` | `GetTokens`, `SaveTokens` |
| `maintenance.go` | `CleanupOldData` (data retention) |
| ... | 10+ more repositories |

All repositories use `pgx/v5` for high-performance PostgreSQL access with prepared statements and connection pooling.

### Tesla API Client (`internal/tesla/`)

| File | Purpose |
|------|---------|
| `client.go` | HTTP client with circuit breaker, `GetVehicles`, `GetVehicleData`, `ExecuteCommand`, `WakeVehicle` |
| `auth.go` | OAuth2 flow: `GetLoginURL`, `ExchangeCode`, `RefreshToken` |
| `types.go` | Go structs matching Tesla API JSON responses |

### Worker (`internal/worker/`)

| File | Purpose |
|------|---------|
| `worker.go` | Main polling loop — fetches vehicle data and persists to DB + MQTT + SSE |
| `maintenance_worker.go` | Periodic cleanup based on retention configuration |

## Frontend Architecture

### Pages (`web/src/pages/`)

25+ pages, all lazy-loaded via `React.lazy()`:

- Each page is a self-contained module with its own data fetching (TanStack Query)
- Pages use shared components from `components/`
- Pages are wrapped in `ErrorBoundary` + `Suspense` for graceful loading/error states

### Components (`web/src/components/`)

| Component | Purpose |
|-----------|---------|
| `Layout.tsx` | Main app shell — sidebar navigation, top bar, command palette |
| `ui.tsx` | 13 reusable glass-morphism UI primitives (GlassPanel, StatCard, Button, Input, Table, Modal, Badge, etc.) |
| `ThemeProvider.tsx` | 5-theme system using CSS custom properties |
| `CommandPalette.tsx` | Cmd+K quick navigation |
| `TeslaCarViz.tsx` | Vehicle visualization component |
| `Toast.tsx` | Toast notification system |
| `ErrorBoundary.tsx` | Error isolation per route |
| `ServiceStatus.tsx` | Backend health indicator |
| `Widgets.tsx` | Reusable dashboard widgets |

### Hooks (`web/src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useRealtimeEvents.ts` | SSE connection with auto-reconnect, event parsing, connection status |

### API Client (`web/src/api.ts`)

Typed fetch wrapper for all backend endpoints. Used with TanStack Query:

```tsx
// Example: Fetching vehicles
const { data: vehicles, isLoading } = useQuery({
  queryKey: ['vehicles'],
  queryFn: () => api.vehicles.list(),
})
```

## Database Migrations

Migrations are in `migrations/` using the `golang-migrate` format:

```
000001_initial.up.sql          # Core tables: vehicles, positions, drives, charging
000001_initial.down.sql        # Rollback for migration 1
000002_alerts_commands_energy.up.sql   # Alerts, commands, energy
000003_states_vampire_mileage.up.sql   # Vehicle states, vampire drain, mileage
000004_geofence_electricity_cost.up.sql # Geofence cost tracking
000005_notifications.up.sql    # Notification channels, logs, chat, tire pressure
```

Migrations run automatically on backend startup. The `positions` table uses native PostgreSQL partitioning for efficient time-series queries.

## Build System

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make build` | Compile Go binary to `./bin/teslasync` |
| `make run` | Run backend directly with `go run` |
| `make test` | Run Go tests with race detector |
| `make lint` | Run golangci-lint |
| `make clean` | Remove build artifacts |
| `make web-install` | `npm ci` in web/ |
| `make web-dev` | Start Vite dev server |
| `make web-build` | Production build of frontend |
| `make web-lint` | ESLint check |
| `make docker` | Build Docker images |
| `make docker-up` | `docker compose up -d` |
| `make docker-down` | `docker compose down` |
| `make docker-logs` | Tail all container logs |
| `make helm-install` | Install Helm chart |
| `make helm-uninstall` | Remove Helm release |
| `make help` | Show all targets |

### GoReleaser

`.goreleaser.yml` automates cross-platform binary releases:

- **Platforms:** linux, darwin, windows × amd64, arm64
- **Artifacts:** tar.gz (Unix), zip (Windows)
- **Build args:** VERSION, COMMIT, BUILD_TIME injected via ldflags
- **Changelog:** Auto-generated, excludes docs/test/ci commits
