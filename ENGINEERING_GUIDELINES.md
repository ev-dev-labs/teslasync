# TeslaSync Engineering Guidelines

> **Purpose:** Authoritative reference for the TeslaSync refactoring effort. Every engineer
> contributing to this codebase must read and follow these guidelines. The primary goal is to
> eliminate fragmented, duplicated, and inconsistent code while establishing patterns that
> prevent those problems from recurring.

### Document Governance

| Property | Value |
|----------|-------|
| **Owner** | TeslaSync Engineering Lead |
| **Approval authority** | Engineering Lead + one domain owner (backend / frontend / infra) |
| **Review cadence** | Quarterly, or when a major architectural change is proposed |
| **Exception process** | File an ADR in `docs/adr/` with justification. Requires two approvals. Exceptions are time-boxed. |
| **Enforcement** | Every "MUST" / "NEVER" rule maps to at least one automated check (linter, CI job, policy controller) or a mandatory code-review gate. Unenforced rules are tracked as tech-debt issues. |
| **Changelog** | Maintained in `docs/adr/guidelines-changelog.md`. Every edit to this doc requires a dated entry. |

### Version & Support Matrix

| Component | Supported Version | Upgrade Cadence | Owner |
|-----------|-------------------|-----------------|-------|
| Go | 1.25.x (pinned via `toolchain` directive in `go.mod`) | Within 4 weeks of minor release | Backend |
| React | 18.x | Quarterly evaluation | Frontend |
| TypeScript | 5.4.x | With React upgrades | Frontend |
| PostgreSQL | 17.x | Major: annual; Minor: within 2 weeks | Backend / Infra |
| Redis | 7.x | Minor: within 2 weeks | Backend / Infra |
| Kubernetes | 1.29–1.31 (current ± 1 minor) | Within 6 weeks of upstream release | Infra |
| Node.js (build) | 20 LTS | With LTS cycle | Frontend |
| Browsers | Latest 2 versions of Chrome, Firefox, Safari, Edge; iOS Safari 16+ | Reviewed quarterly | Frontend |

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [Repository & Project Structure](#2-repository--project-structure)
3. [Go Backend Guidelines](#3-go-backend-guidelines)
4. [React / TypeScript Frontend Guidelines](#4-react--typescript-frontend-guidelines)
5. [Database & Data-Access Patterns](#5-database--data-access-patterns)
6. [API Design & Contracts](#6-api-design--contracts)
7. [MQTT & Messaging](#7-mqtt--messaging)
8. [Finite State Machines (FSM & SubFSM)](#8-finite-state-machines-fsm--subfsm)
9. [External API Integration](#9-external-api-integration)
10. [Error Handling & Resilience](#10-error-handling--resilience)
11. [Testing Strategy](#11-testing-strategy)
12. [Observability (Logging, Metrics, Tracing)](#12-observability-logging-metrics-tracing)
13. [Security](#13-security)
14. [Infrastructure & Deployment](#14-infrastructure--deployment)
15. [CI/CD & Code Quality Gates](#15-cicd--code-quality-gates)
16. [Refactoring Playbook](#16-refactoring-playbook)
17. [Anti-Patterns Catalog](#17-anti-patterns-catalog)
18. [Code Review Checklist](#18-code-review-checklist)
19. [Decision Log](#19-decision-log)
20. [AI Agent (Copilot) Strict Operating Rules](#20-ai-agent-copilot-strict-operating-rules)
21. [Performance Budgets & SLOs](#21-performance-budgets--slos)
22. [Incident Management & Operations](#22-incident-management--operations)
23. [Release Engineering](#23-release-engineering)
24. [Governance & Ownership](#24-governance--ownership)

---

## 1. Guiding Principles

| # | Principle | What It Means in Practice |
|---|-----------|---------------------------|
| 1 | **Single Source of Truth (SSOT)** | Every piece of business logic, configuration value, type definition, or SQL query lives in exactly one place. Everything else imports it. |
| 2 | **Explicit Over Implicit** | No magic strings, no hidden coupling. If two packages depend on each other, the dependency graph must be visible in imports. |
| 3 | **Composition Over Inheritance** | Prefer small, composable interfaces (Go) and composable hooks/components (React) over deep hierarchies. |
| 4 | **Fail Fast, Recover Gracefully** | Validate inputs at the boundary. Return structured errors. Never swallow errors silently. |
| 5 | **Observability by Default** | Every service call, database query, and external API request must be traceable end-to-end. |
| 6 | **Automate the Guardrails** | Linters, formatters, type-checkers, and tests run in CI. If a rule is important, enforce it with tooling—not just documentation. |
| 7 | **Small, Reviewable Changes** | PRs should be < 400 lines of logic changes. Large refactors are split into a series of PRs that individually pass CI. |

---

## 2. Repository & Project Structure

### 2.1 Monorepo Layout

```
teslasync/
├── cmd/                          # Entry points — one folder per binary
│   ├── teslasync/                # API server (port 8080)
│   │   └── main.go
│   ├── notification-worker/      # Notification worker (port 8081)
│   │   └── main.go
│   └── export-worker/            # Export worker (port 8082)
│       └── main.go
│
├── internal/                     # Private application code (not importable outside module)
│   ├── domain/                   # Pure domain types & business rules — ZERO external deps
│   │   ├── vehicle/              # Vehicle aggregate: types, validation, business rules
│   │   ├── charging/             # Charging session aggregate
│   │   ├── trip/                 # Trip aggregate
│   │   ├── user/                 # User/account aggregate
│   │   ├── notification/         # Notification domain types
│   │   ├── export/               # Export job domain types
│   │   └── fsm/                  # Shared FSM engine, SubFSM support, transition registry
│   │
│   ├── app/                      # Application services (use cases / orchestration)
│   │   ├── vehiclesvc/           # Vehicle use cases
│   │   ├── chargingsvc/          # Charging use cases
│   │   ├── tripsvc/              # Trip use cases
│   │   ├── notificationsvc/      # Notification orchestration
│   │   └── exportsvc/            # Export orchestration
│   │
│   ├── port/                     # Port interfaces (driven + driving)
│   │   ├── repository/           # Repository interfaces (driven ports)
│   │   ├── messaging/            # Messaging interfaces (driven ports)
│   │   ├── external/             # External API interfaces (driven ports)
│   │   └── handler/              # HTTP handler interfaces (driving ports)
│   │
│   ├── adapter/                  # Concrete implementations of port interfaces
│   │   ├── postgres/             # pgx-based repository implementations
│   │   ├── redis/                # go-redis cache implementations
│   │   ├── mongo/                # MongoDB telemetry store
│   │   ├── mqtt/                 # Mosquitto MQTT adapter
│   │   ├── tesla/                # Tesla Fleet API + Vehicle Command SDK
│   │   ├── geocoding/            # Google Maps / Azure Maps / Nominatim
│   │   ├── gasprices/            # EIA API adapter
│   │   └── storage/              # S3 / GCS / Azure Blob adapter
│   │
│   ├── handler/                  # HTTP handlers (Chi routes)
│   │   ├── v1/                   # Versioned API handlers
│   │   ├── middleware/           # HTTP middleware (auth, logging, metrics, recovery)
│   │   └── dto/                  # Request/response DTOs — conversion to/from domain types
│   │
│   ├── worker/                   # Background worker logic
│   │   ├── notification/         # Notification worker implementation
│   │   └── export/               # Export worker implementation
│   │
│   └── platform/                 # Cross-cutting infrastructure
│       ├── config/               # Configuration loading (env, files)
│       ├── database/             # DB connection pool, migration runner
│       ├── cache/                # Redis connection, generic cache helpers
│       ├── auth/                 # JWT validation, JWKS fetching
│       ├── telemetry/            # OpenTelemetry setup, Prometheus registry
│       ├── httputil/             # HTTP client helpers, retry, circuit breaker
│       └── testutil/             # Shared test helpers, fixtures, mocks
│
├── migrations/                   # golang-migrate SQL files (sequential, numbered)
│   ├── 000001_initial.up.sql
│   ├── 000001_initial.down.sql
│   └── ...
│
├── web/                          # React frontend
│   ├── src/
│   │   ├── api/                  # TanStack Query hooks + API client (single HTTP layer)
│   ├── components/           # SHARED reusable components — the component library
│   │   │   ├── ui/               # Primitives: Button, Input, Card, Modal, Badge, Select, etc.
│   │   │   ├── layout/           # Shell, Sidebar, Header, Footer, PageContainer, SplitPane
│   │   │   ├── feedback/         # Toast, Spinner, ErrorBoundary, EmptyState, Skeleton
│   │   │   ├── data-display/     # DataTable, StatCard, KVList, Timeline, ProgressBar
│   │   │   ├── charts/           # ChartContainer, TimeSeriesChart, GaugeChart (Recharts wrappers)
│   │   │   ├── maps/             # MapContainer, MapMarker, MapRoute (Leaflet wrappers)
│   │   │   ├── forms/            # FormField, FormSection, SearchInput, DateRangePicker
│   │   │   └── motion/           # AnimatedList, FadeIn, SlideIn (Framer Motion wrappers)
│   │   ├── features/             # Feature modules (co-located components + hooks + types)
│   │   │   ├── vehicles/
│   │   │   ├── charging/
│   │   │   ├── trips/
│   │   │   ├── dashboard/
│   │   │   ├── settings/
│   │   │   └── maps/
│   │   ├── hooks/                # Shared custom hooks
│   │   ├── lib/                  # Utility functions, constants, formatters
│   │   ├── routes/               # React Router v6 route definitions
│   │   ├── types/                # Shared TypeScript types & API response types
│   │   ├── i18n/                 # i18next configuration & translation files
│   │   ├── styles/               # Tailwind config extensions, global CSS
│   │   └── test/                 # Test setup, MSW handlers, render helpers
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── deploy/                       # Deployment manifests
│   ├── helm/                     # Helm chart
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   ├── values-prod.yaml
│   │   └── templates/
│   ├── docker/
│   │   ├── Dockerfile.api        # Multi-stage, distroless runtime
│   │   ├── Dockerfile.worker     # Shared base for both workers
│   │   └── Dockerfile.web        # nginx-based frontend
│   └── mosquitto/                # Mosquitto config
│
├── docs/                         # Architecture Decision Records, API docs
│   ├── adr/
│   └── api/
│
├── .github/
│   └── workflows/                # GitHub Actions
│       ├── ci.yml
│       ├── release.yml
│       └── security.yml
│
├── go.mod
├── go.sum
├── .golangci.yml                 # golangci-lint config
├── .eslintrc.cjs                 # ESLint config
└── ENGINEERING_GUIDELINES.md     # ← This document
```

### 2.2 Structural Rules

| Rule | Rationale |
|------|-----------|
| `cmd/` contains **only** wiring code (dependency injection, signal handling, graceful shutdown). No business logic. | Keeps entry points thin and testable. |
| `internal/domain/` has **zero imports** from `internal/adapter/`, `internal/handler/`, or any external package except the Go stdlib. | Guarantees domain logic is pure and portable. |
| `internal/port/` defines **interfaces only**. No implementations. | Enforces the Dependency Inversion Principle. |
| `internal/adapter/` implements port interfaces. Each adapter lives in its own sub-package. | Swappable implementations; clear boundaries. |
| `internal/handler/dto/` is the **only** place where HTTP request/response shapes are defined. Handlers convert DTO ↔ domain. | Prevents domain types from leaking HTTP concerns. |
| `web/src/features/` is the primary code-organization axis for the frontend. Shared code lives in `components/`, `hooks/`, `lib/`. | Co-locating feature code reduces cross-feature coupling. |
| **No circular imports.** The dependency direction is: `cmd → handler → app → domain ← port ← adapter`. | Enforced by Go compiler; verified in CI. |

### 2.3 File Naming Conventions

| Language | Convention | Examples |
|----------|-----------|----------|
| Go | `snake_case.go` | `vehicle_repository.go`, `charging_service.go` |
| Go tests | `*_test.go` in same package (unit) or `*_integration_test.go` with build tag | `vehicle_repository_test.go` |
| TypeScript | `PascalCase` for components, `camelCase` for utilities | `VehicleCard.tsx`, `formatDistance.ts` |
| TypeScript tests | `*.test.ts` / `*.test.tsx` co-located next to source | `VehicleCard.test.tsx` |
| SQL migrations | `NNNNNN_description.{up,down}.sql` | `000045_add_charging_cost.up.sql` |
| CSS/Tailwind | Use Tailwind utility classes inline. Extract to `@apply` only for repeated multi-class patterns. | — |

---

## 3. Go Backend Guidelines

### 3.1 Module & Package Design

**Rule: One package = one responsibility.**

```
# BAD — "utils" or "helpers" packages that become junk drawers
internal/utils/helpers.go      // ← What does this even do?
internal/utils/http.go
internal/utils/db.go
internal/utils/strings.go

# GOOD — Purpose-named packages
internal/platform/httputil/     // HTTP client helpers
internal/platform/database/     // DB pool + migration
internal/platform/cache/        // Redis helpers
```

**Rule: Packages expose behavior through interfaces defined in `internal/port/`.**

```go
// internal/port/repository/vehicle.go
package repository

import "context"
import "github.com/yourorg/teslasync/internal/domain/vehicle"

type VehicleRepository interface {
    GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error)
    GetByUserID(ctx context.Context, userID string) ([]vehicle.Vehicle, error)
    Save(ctx context.Context, v *vehicle.Vehicle) error
    Delete(ctx context.Context, id string) error
}
```

```go
// internal/adapter/postgres/vehicle_repository.go
package postgres

type vehicleRepository struct {
    pool *pgxpool.Pool
}

func NewVehicleRepository(pool *pgxpool.Pool) repository.VehicleRepository {
    return &vehicleRepository{pool: pool}
}
```

### 3.2 Dependency Injection

All dependencies are wired in `cmd/*/main.go` using **constructor injection**. No global variables. No `init()` functions with side effects.

```go
// cmd/teslasync/main.go
func main() {
    cfg := config.MustLoad()

    // Infrastructure
    pool := database.MustConnect(cfg.Database)
    defer pool.Close()
    redisClient := cache.MustConnect(cfg.Redis)
    defer redisClient.Close()

    // Adapters (implement port interfaces)
    vehicleRepo := postgres.NewVehicleRepository(pool)
    vehicleCache := rediscache.NewVehicleCache(redisClient)
    teslaClient := tesla.NewClient(cfg.Tesla)

    // Application services (depend on port interfaces, not adapters)
    vehicleSvc := vehiclesvc.New(vehicleRepo, vehicleCache, teslaClient)

    // HTTP handlers
    vehicleHandler := v1.NewVehicleHandler(vehicleSvc)

    // Router
    r := chi.NewRouter()
    r.Use(middleware.Logger, middleware.Recoverer, middleware.Metrics)
    r.Route("/api/v1", func(r chi.Router) {
        vehicleHandler.Register(r)
    })

    // Graceful shutdown...
}
```

### 3.3 Error Handling in Go

**Rule: Define domain errors. Map them to HTTP status codes in the handler layer only.**

```go
// internal/domain/errors.go — SINGLE source of domain errors
package domain

import "errors"

var (
    ErrNotFound       = errors.New("not found")
    ErrConflict       = errors.New("conflict")
    ErrUnauthorized   = errors.New("unauthorized")
    ErrForbidden      = errors.New("forbidden")
    ErrValidation     = errors.New("validation failed")
    ErrRateLimited    = errors.New("rate limited")
    ErrExternalAPI    = errors.New("external api error")
)

// ValidationError carries field-level details
type ValidationError struct {
    Field   string `json:"field"`
    Message string `json:"message"`
}

type ValidationErrors []ValidationError

func (ve ValidationErrors) Error() string { /* ... */ }
```

```go
// internal/handler/middleware/error_mapper.go — maps domain errors → HTTP responses
func MapDomainError(err error) (int, APIError) {
    switch {
    case errors.Is(err, domain.ErrNotFound):
        return http.StatusNotFound, APIError{Code: "NOT_FOUND", Message: err.Error()}
    case errors.Is(err, domain.ErrValidation):
        return http.StatusBadRequest, APIError{Code: "VALIDATION_ERROR", Message: err.Error()}
    case errors.Is(err, domain.ErrConflict):
        return http.StatusConflict, APIError{Code: "CONFLICT", Message: err.Error()}
    case errors.Is(err, domain.ErrRateLimited):
        return http.StatusTooManyRequests, APIError{Code: "RATE_LIMITED", Message: err.Error()}
    default:
        return http.StatusInternalServerError, APIError{Code: "INTERNAL", Message: "internal server error"}
    }
}
```

**Rule: Wrap errors with context using `fmt.Errorf("...: %w", err)`. Never discard the original error.**

```go
// GOOD
func (r *vehicleRepository) GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error) {
    row := r.pool.QueryRow(ctx, queryGetVehicleByID, id)
    var v vehicle.Vehicle
    if err := row.Scan(&v.ID, &v.Name, &v.VIN); err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return nil, fmt.Errorf("vehicle %s: %w", id, domain.ErrNotFound)
        }
        return nil, fmt.Errorf("querying vehicle %s: %w", id, err)
    }
    return &v, nil
}

// BAD — error context is lost
if err != nil {
    return nil, errors.New("failed")  // ← What failed? Where? Why?
}

// BAD — error is swallowed
if err != nil {
    log.Error().Err(err).Msg("something went wrong")
    // ← caller has no idea this failed
}
```

### 3.4 Context Propagation

Every function that does I/O **must** accept `context.Context` as its first parameter. This enables:
- Request-scoped cancellation & timeouts
- OpenTelemetry trace propagation
- Zerolog field propagation

```go
// GOOD
func (s *VehicleService) Refresh(ctx context.Context, vehicleID string) error {
    ctx, span := otel.Tracer("vehiclesvc").Start(ctx, "VehicleService.Refresh")
    defer span.End()
    // ...
}

// BAD — no context, can't cancel, can't trace
func (s *VehicleService) Refresh(vehicleID string) error { /* ... */ }
```

### 3.5 SQL & Database Access

**Rule: All SQL lives in the adapter layer. Domain and application layers never see raw SQL.**

**Rule: Use query constants, not inline strings scattered across functions.**

```go
// internal/adapter/postgres/queries/vehicle.go
package queries

const (
    GetVehicleByID = `
        SELECT id, user_id, vin, display_name, state, created_at, updated_at
        FROM vehicles
        WHERE id = $1`

    GetVehiclesByUserID = `
        SELECT id, user_id, vin, display_name, state, created_at, updated_at
        FROM vehicles
        WHERE user_id = $1
        ORDER BY display_name`

    UpsertVehicle = `
        INSERT INTO vehicles (id, user_id, vin, display_name, state, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            state = EXCLUDED.state,
            updated_at = EXCLUDED.updated_at`
)
```

**Rule: Use `pgx.CollectRows` with scanning functions for type safety.**

```go
func (r *vehicleRepository) GetByUserID(ctx context.Context, userID string) ([]vehicle.Vehicle, error) {
    rows, err := r.pool.Query(ctx, queries.GetVehiclesByUserID, userID)
    if err != nil {
        return nil, fmt.Errorf("querying vehicles for user %s: %w", userID, err)
    }
    vehicles, err := pgx.CollectRows(rows, pgx.RowToStructByName[vehicle.Vehicle])
    if err != nil {
        return nil, fmt.Errorf("scanning vehicles for user %s: %w", userID, err)
    }
    return vehicles, nil
}
```

**Rule: Transactions are managed by the application service layer, not the repository.**

```go
// internal/app/chargingsvc/service.go
func (s *Service) CompleteSession(ctx context.Context, sessionID string) error {
    tx, err := s.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback(ctx) // no-op if committed

    if err := s.chargingRepo.WithTx(tx).MarkComplete(ctx, sessionID); err != nil {
        return fmt.Errorf("marking session complete: %w", err)
    }
    if err := s.costRepo.WithTx(tx).CalculateAndStore(ctx, sessionID); err != nil {
        return fmt.Errorf("calculating cost: %w", err)
    }

    return tx.Commit(ctx)
}
```

### 3.6 Concurrency

| Pattern | When to Use |
|---------|-------------|
| `errgroup.Group` | Fan-out concurrent work that must all succeed (e.g., fetching data from multiple Tesla vehicles). |
| `sync.WaitGroup` | Fire-and-forget concurrent work where individual errors are logged but don't fail the parent. |
| Channels | Producer/consumer patterns, signal batching from MQTT. |
| `sync.Once` | Lazy initialization of expensive resources. |
| `context.WithTimeout` | All external calls (Tesla API, geocoding, DB queries in tight loops). |

**Rule: Never use bare goroutines. Always use `errgroup` or explicitly handle panics.**

```go
// GOOD
g, ctx := errgroup.WithContext(ctx)
for _, v := range vehicles {
    v := v
    g.Go(func() error {
        return s.refreshVehicle(ctx, v.ID)
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("refreshing vehicles: %w", err)
}

// BAD — goroutine leak, panic crash, no error propagation
for _, v := range vehicles {
    go s.refreshVehicle(ctx, v.ID)
}
```

### 3.7 Configuration

**Rule: All configuration is loaded once at startup via `internal/platform/config/`. No scattered `os.Getenv` calls.**

```go
// internal/platform/config/config.go
type Config struct {
    Server   ServerConfig
    Database DatabaseConfig
    Redis    RedisConfig
    Tesla    TeslaConfig
    MQTT     MQTTConfig
    Auth     AuthConfig
    // ...
}

type ServerConfig struct {
    Port            int           `env:"SERVER_PORT" envDefault:"8080"`
    ReadTimeout     time.Duration `env:"SERVER_READ_TIMEOUT" envDefault:"10s"`
    WriteTimeout    time.Duration `env:"SERVER_WRITE_TIMEOUT" envDefault:"30s"`
    ShutdownTimeout time.Duration `env:"SERVER_SHUTDOWN_TIMEOUT" envDefault:"15s"`
}

func MustLoad() *Config {
    var cfg Config
    if err := env.Parse(&cfg); err != nil {
        log.Fatal().Err(err).Msg("failed to parse config")
    }
    cfg.validate() // fail fast on invalid combinations
    return &cfg
}
```

**Rule: Feature flags & runtime toggles use config values, not code comments or `if false {}` blocks.**

### 3.8 Interface Segregation

**Rule: Interfaces belong to the consumer, not the provider. Keep interfaces small.**

```go
// BAD — fat interface that forces mocking 10 methods when you only need 2
type VehicleStore interface {
    GetByID(ctx context.Context, id string) (*Vehicle, error)
    GetByUserID(ctx context.Context, userID string) ([]Vehicle, error)
    GetByVIN(ctx context.Context, vin string) (*Vehicle, error)
    Save(ctx context.Context, v *Vehicle) error
    Delete(ctx context.Context, id string) error
    List(ctx context.Context, filter Filter) ([]Vehicle, error)
    Count(ctx context.Context, filter Filter) (int, error)
    UpdateState(ctx context.Context, id string, state State) error
    GetHistory(ctx context.Context, id string) ([]HistoryEntry, error)
    Search(ctx context.Context, query string) ([]Vehicle, error)
}

// GOOD — consumer-sized interfaces
type VehicleReader interface {
    GetByID(ctx context.Context, id string) (*Vehicle, error)
    GetByUserID(ctx context.Context, userID string) ([]Vehicle, error)
}

type VehicleWriter interface {
    Save(ctx context.Context, v *Vehicle) error
    Delete(ctx context.Context, id string) error
}

// Services accept only the methods they need
type RefreshService struct {
    reader VehicleReader
    writer VehicleWriter
    tesla  TeslaStateGetter  // not the full TeslaClient
}
```

**Rule: Do not create interfaces preemptively. Extract interfaces when a second consumer appears or when testability requires it.**

### 3.9 Domain Validation

**Rule: Transport validation (DTO shape) and domain validation (business invariants) are separate.**

```go
// Transport validation — in handler/dto/ — checks shape
type CreateVehicleRequest struct {
    VIN         string `json:"vin" validate:"required,len=17"`
    DisplayName string `json:"displayName" validate:"required,min=1,max=100"`
}

// Domain validation — in domain/vehicle/ — checks invariants
func (v *Vehicle) Validate() error {
    var errs domain.ValidationErrors
    if !isValidVIN(v.VIN) {
        errs = append(errs, domain.ValidationError{Field: "vin", Message: "invalid VIN checksum"})
    }
    if v.Year < 2012 || v.Year > time.Now().Year()+1 {
        errs = append(errs, domain.ValidationError{Field: "year", Message: "year out of range for Tesla"})
    }
    if len(errs) > 0 {
        return errs
    }
    return nil
}

// Application service calls BOTH
func (s *Service) Create(ctx context.Context, v *vehicle.Vehicle) error {
    if err := v.Validate(); err != nil {
        return fmt.Errorf("vehicle validation: %w", err)
    }
    // ... proceed
}
```

### 3.10 Dependency Management (`go.mod`)

| Rule | Details |
|------|---------|
| `go.mod` uses `toolchain go1.25.x` | Pin the exact toolchain to prevent drift across machines |
| `go mod tidy` runs in CI | Fail if `go.sum` changes (prevents uncommitted dependency changes) |
| `go mod verify` runs in CI | Validates checksums of downloaded modules |
| No `replace` directives in main module | Allowed only in local dev or forked-dependency cases; must have an ADR |
| Direct dependencies require review | New `require` entries must be justified in the PR description |
| Tool dependencies use `//go:build tools` file | Keep `golangci-lint`, `golang-migrate`, etc. in a `tools.go` for reproducibility |
| Indirect dependency audits | `govulncheck` + `go mod graph` reviewed on Dependabot PRs |
| License allowlist enforced in CI | MIT, BSD-2, BSD-3, Apache-2.0, ISC, MPL-2.0 allowed. GPL/AGPL blocked. |

### 3.11 Build Metadata & Versioning

**Rule: Every binary embeds version, commit SHA, and build date via `-ldflags`.**

```go
// internal/platform/buildinfo/buildinfo.go
var (
    Version   = "dev"      // set via -ldflags
    Commit    = "unknown"  // set via -ldflags
    BuildDate = "unknown"  // set via -ldflags
)
```

```dockerfile
RUN CGO_ENABLED=0 go build \
    -ldflags="-s -w \
      -X github.com/yourorg/teslasync/internal/platform/buildinfo.Version=${VERSION} \
      -X github.com/yourorg/teslasync/internal/platform/buildinfo.Commit=${COMMIT_SHA} \
      -X github.com/yourorg/teslasync/internal/platform/buildinfo.BuildDate=${BUILD_DATE}" \
    -o /teslasync ./cmd/teslasync
```

**Rule: Every binary logs version info on startup and exposes `GET /version`.**

### 3.12 Graceful Shutdown — Full Sequence

```go
// cmd/teslasync/main.go — production-grade shutdown
func gracefulShutdown(
    ctx context.Context,
    server *http.Server,
    mqttClient mqtt.Client,
    pool *pgxpool.Pool,
    redis *redis.Client,
    tp *sdktrace.TracerProvider,
    timeout time.Duration,
) {
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    log.Info().Msg("shutdown signal received")
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    // 1. Mark unhealthy (readiness probe fails → no new traffic)
    readinessProbe.SetUnhealthy()

    // 2. Stop accepting new MQTT messages
    mqttClient.Unsubscribe(topics...)

    // 3. Stop accepting new HTTP requests + drain in-flight
    if err := server.Shutdown(ctx); err != nil {
        log.Error().Err(err).Msg("http server shutdown error")
    }

    // 4. Wait for in-flight background work (errgroups, workers)
    workerGroup.Wait()

    // 5. Flush telemetry (spans, metrics)
    if err := tp.Shutdown(ctx); err != nil {
        log.Error().Err(err).Msg("trace provider shutdown error")
    }

    // 6. Close infrastructure connections
    pool.Close()
    redis.Close()
    mqttClient.Disconnect(250)

    log.Info().Msg("shutdown complete")
}
```

---

## 4. React / TypeScript Frontend Guidelines

### 4.1 Component Architecture

**Rule: Use a three-tier component model. The shared tier (components/) is the mandatory reusable library.**

| Tier | Location | Responsibility | Reusable? | Examples |
|------|----------|---------------|-----------|----------|
| **Shared Components** | `components/` | Stateless or minimally-stateful. Zero business logic. Accept props, render UI. **Every component here is reusable across all features.** | ✅ Mandatory | `Button`, `DataTable`, `StatCard`, `MapContainer`, `ChartContainer` |
| **Feature Components** | `features/*/components/` | Feature-specific composition. May use TanStack Query hooks. Compose shared components. | ⚠️ Within feature | `VehicleCard`, `ChargingChart`, `TripMap` |
| **Page Components** | `features/*/pages/` or `routes/` | Route-level. Compose feature components. Handle layout + data orchestration. | ❌ Not reusable | `VehicleDashboardPage`, `SettingsPage` |

**Reusability mandate:** Feature components MUST be assembled from shared components. If a feature
component creates raw `<div>`, `<button>`, or `<input>` elements with Tailwind classes that already
exist as a shared component — that is a code review rejection.

```tsx
// BAD — feature component creating raw UI primitives
function VehicleActions({ vehicle }: Props) {
  return (
    <div className="flex gap-2">
      <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
        Refresh
      </button>
      <button className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
        Details
      </button>
    </div>
  );
}

// GOOD — composing shared components
import { Button } from '@/components/ui/Button';

function VehicleActions({ vehicle }: Props) {
  return (
    <div className="flex gap-2">
      <Button variant="primary" size="sm" onClick={() => onRefresh(vehicle.id)}>
        {t('actions.refresh')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => navigate(`/vehicles/${vehicle.id}`)}>
        {t('actions.details')}
      </Button>
    </div>
  );
}
```

**Rule: No component file should exceed 200 lines. If it does, extract sub-components or custom hooks.**

### 4.2 Reusable Component Library — Complete Catalog

Every shared component listed below MUST exist in `components/`. This is the **canonical UI library**
for TeslaSync. Feature teams consume these — they do not reinvent them.

#### 4.2.1 UI Primitives (`components/ui/`)

These are the atomic building blocks. Every primitive supports `className` override via `cn()`.

```tsx
// components/ui/Button.tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/feedback/Spinner';

const variants = {
  primary:   'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100',
  outline:   'border border-gray-300 bg-transparent hover:bg-gray-50 dark:border-gray-600',
  danger:    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
  ghost:     'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
```

**Complete UI primitives catalog:**

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `Button` | `ui/Button.tsx` | `variant`, `size`, `loading`, `icon`, `disabled` | All clickable actions |
| `IconButton` | `ui/IconButton.tsx` | `icon`, `label` (a11y), `variant`, `size` | Icon-only actions (tooltip on hover) |
| `Badge` | `ui/Badge.tsx` | `variant` (info/success/warning/danger/neutral), `size`, `dot` | Status indicators, counts |
| `Card` | `ui/Card.tsx` | `padding`, `hover`, `onClick`, `className` | Content container |
| `CardHeader` | `ui/Card.tsx` | `title`, `subtitle`, `action` (ReactNode) | Card title row with optional action slot |
| `Input` | `ui/Input.tsx` | `label`, `error`, `hint`, `icon`, `type` | Text inputs with built-in label + error |
| `Select` | `ui/Select.tsx` | `options`, `value`, `onChange`, `placeholder`, `label`, `error` | Dropdown select |
| `Checkbox` | `ui/Checkbox.tsx` | `label`, `checked`, `onChange`, `indeterminate` | Boolean toggle |
| `Toggle` | `ui/Toggle.tsx` | `label`, `checked`, `onChange`, `size` | On/off switch |
| `Modal` | `ui/Modal.tsx` | `open`, `onClose`, `title`, `size`, `children` | Dialog overlay |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` | `open`, `title`, `message`, `onConfirm`, `onCancel`, `variant` | Destructive action confirmation |
| `Tabs` | `ui/Tabs.tsx` | `tabs`, `activeTab`, `onChange` | Tab navigation |
| `Tooltip` | `ui/Tooltip.tsx` | `content`, `side`, `children` | Hover/focus info |
| `Avatar` | `ui/Avatar.tsx` | `src`, `fallback`, `size` | User/vehicle image |
| `Divider` | `ui/Divider.tsx` | `label`, `orientation` | Section separator |
| `StateBadge` | `ui/StateBadge.tsx` | `config`, `subState`, `size` | FSM state display (§8.13) |

**Rule: Every UI primitive uses `forwardRef` and spreads remaining props to the root element.**

**Rule: Every UI primitive accepts `className` and merges it via the `cn()` utility.**

```typescript
// lib/utils.ts — the cn() utility (MANDATORY for all components)
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

#### 4.2.2 Layout Components (`components/layout/`)

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `AppShell` | `layout/AppShell.tsx` | `sidebar`, `header`, `children` | Top-level app layout frame |
| `Sidebar` | `layout/Sidebar.tsx` | `items`, `collapsed`, `onToggle` | Navigation sidebar |
| `Header` | `layout/Header.tsx` | `title`, `breadcrumbs`, `actions` | Page header with breadcrumb + actions slot |
| `PageContainer` | `layout/PageContainer.tsx` | `title`, `subtitle`, `actions`, `loading`, `error`, `children` | Standard page wrapper (handles loading/error states) |
| `SplitPane` | `layout/SplitPane.tsx` | `left`, `right`, `ratio`, `collapsible` | Two-panel layout (e.g., list + detail) |
| `Stack` | `layout/Stack.tsx` | `direction`, `gap`, `align`, `justify`, `children` | Flexbox shorthand |
| `Grid` | `layout/Grid.tsx` | `cols`, `gap`, `children` | CSS Grid shorthand |
| `Section` | `layout/Section.tsx` | `title`, `description`, `collapsible`, `children` | Labeled content section with optional collapse |

```tsx
// components/layout/PageContainer.tsx
import { Spinner } from '@/components/feedback/Spinner';
import { ErrorDisplay } from '@/components/feedback/ErrorDisplay';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({
  title, subtitle, actions, loading, error, empty, emptyMessage, children, className,
}: PageContainerProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Header row — always visible */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Content area — conditional rendering */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" label={`Loading ${title.toLowerCase()}…`} />
        </div>
      ) : error ? (
        <ErrorDisplay error={error} />
      ) : empty ? (
        <EmptyState message={emptyMessage ?? `No ${title.toLowerCase()} found.`} />
      ) : (
        children
      )}
    </div>
  );
}
```

**How feature pages use it:**

```tsx
// features/vehicles/pages/VehicleListPage.tsx
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { VehicleGrid } from '../components/VehicleGrid';
import { useVehicles } from '@/api/hooks/useVehicles';

export function VehicleListPage() {
  const { data: vehicles, isLoading, error } = useVehicles();
  const { t } = useTranslation('vehicles');

  return (
    <PageContainer
      title={t('list.title')}
      subtitle={t('list.subtitle')}
      loading={isLoading}
      error={error}
      empty={vehicles?.length === 0}
      emptyMessage={t('list.empty')}
      actions={<Button icon={<PlusIcon />}>{t('actions.addVehicle')}</Button>}
    >
      <VehicleGrid vehicles={vehicles!} />
    </PageContainer>
  );
}
```

#### 4.2.3 Feedback Components (`components/feedback/`)

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `Spinner` | `feedback/Spinner.tsx` | `size`, `label` | Loading indicator |
| `Skeleton` | `feedback/Skeleton.tsx` | `width`, `height`, `rounded`, `lines` | Content placeholder while loading |
| `ErrorDisplay` | `feedback/ErrorDisplay.tsx` | `error`, `onRetry`, `compact` | Error message with retry action |
| `ErrorBoundary` | `feedback/ErrorBoundary.tsx` | `fallback`, `onError`, `children` | React error boundary wrapper |
| `EmptyState` | `feedback/EmptyState.tsx` | `icon`, `title`, `message`, `action` | No-data placeholder with optional CTA |
| `Toast` / `useToast` | `feedback/Toast.tsx` | `variant`, `title`, `message`, `duration` | Transient notification |
| `ProgressBar` | `feedback/ProgressBar.tsx` | `value`, `max`, `label`, `variant`, `animated` | Progress indicator |
| `Banner` | `feedback/Banner.tsx` | `variant`, `title`, `message`, `dismissible`, `action` | Page-level inline alert |

```tsx
// components/feedback/EmptyState.tsx
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { InboxIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="mb-4 text-gray-400">{icon ?? <InboxIcon size={48} />}</div>
      {title && <h3 className="mb-1 text-lg font-semibold text-gray-700 dark:text-gray-300">{title}</h3>}
      <p className="mb-4 max-w-md text-sm text-gray-500">{message}</p>
      {action && (
        <Button variant="outline" onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}
```

#### 4.2.4 Data Display Components (`components/data-display/`)

These components display structured data consistently across all features.

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `DataTable` | `data-display/DataTable.tsx` | `columns`, `data`, `loading`, `empty`, `sortable`, `onSort`, `onRowClick` | Generic sortable table |
| `StatCard` | `data-display/StatCard.tsx` | `label`, `value`, `unit`, `icon`, `trend`, `loading` | Dashboard metric card |
| `KVList` | `data-display/KVList.tsx` | `items: {label, value}[]`, `columns` | Key-value pairs display |
| `Timeline` | `data-display/Timeline.tsx` | `events: {time, title, description, icon}[]` | Chronological event list |
| `DescriptionList` | `data-display/DescriptionList.tsx` | `items`, `columns` | Labeled detail view |
| `Metric` | `data-display/Metric.tsx` | `label`, `value`, `unit`, `size`, `trend` | Inline metric (non-card) |

```tsx
// components/data-display/StatCard.tsx
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean };
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, unit, icon, trend, loading, className }: StatCardProps) {
  if (loading) {
    return (
      <Card className={className}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={32} className="mt-2" />
      </Card>
    );
  }

  const TrendIcon = trend?.direction === 'up' ? TrendingUp
    : trend?.direction === 'down' ? TrendingDown : Minus;

  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">{value}</span>
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
      {trend && (
        <div className={cn('flex items-center gap-1 text-xs',
          trend.positive ? 'text-green-600' : 'text-red-600',
          trend.direction === 'flat' && 'text-gray-500',
        )}>
          <TrendIcon size={14} />
          <span>{trend.value}</span>
        </div>
      )}
    </Card>
  );
}
```

**How features compose StatCards:**

```tsx
// features/dashboard/components/DashboardStats.tsx — NO custom cards, reuses StatCard
import { StatCard } from '@/components/data-display/StatCard';
import { Grid } from '@/components/layout/Grid';
import { Zap, Navigation, Battery, DollarSign } from 'lucide-react';
import { useDashboardStats } from '@/api/hooks/useDashboard';

export function DashboardStats() {
  const { data, isLoading } = useDashboardStats();

  return (
    <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
      <StatCard
        label={t('stats.totalMiles')}
        value={data?.totalMiles ?? 0}
        unit="mi"
        icon={<Navigation size={18} />}
        trend={{ direction: 'up', value: '+12% this month', positive: true }}
        loading={isLoading}
      />
      <StatCard
        label={t('stats.energyUsed')}
        value={data?.energyUsed ?? 0}
        unit="kWh"
        icon={<Zap size={18} />}
        loading={isLoading}
      />
      <StatCard
        label={t('stats.avgEfficiency')}
        value={data?.avgEfficiency ?? 0}
        unit="Wh/mi"
        icon={<Battery size={18} />}
        loading={isLoading}
      />
      <StatCard
        label={t('stats.totalCost')}
        value={`$${data?.totalCost ?? 0}`}
        icon={<DollarSign size={18} />}
        trend={{ direction: 'down', value: '-5% vs last month', positive: true }}
        loading={isLoading}
      />
    </Grid>
  );
}
```

```tsx
// components/data-display/DataTable.tsx
import { useState, useMemo, type ReactNode } from 'react';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortFn?: (a: T, b: T) => number;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  stickyHeader?: boolean;
  compact?: boolean;
  className?: string;
}

export function DataTable<T>({
  columns, data, keyExtractor, loading, emptyMessage,
  onRowClick, stickyHeader, compact, className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortFn) return data;
    return [...data].sort((a, b) => sort.dir === 'asc' ? col.sortFn!(a, b) : col.sortFn!(b, a));
  }, [data, sort, columns]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="md" /></div>;
  if (data.length === 0) return <EmptyState message={emptyMessage ?? 'No data available.'} />;

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700', className)}>
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className={cn('bg-gray-50 dark:bg-gray-800', stickyHeader && 'sticky top-0')}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-xs',
                  'font-medium uppercase tracking-wider text-gray-500',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.sortable && 'cursor-pointer select-none hover:text-gray-700',
                )}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => col.sortable && setSort((prev) =>
                  prev?.key === col.key
                    ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                    : { key: col.key, dir: 'asc' },
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    sort?.key === col.key
                      ? sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                      : <ChevronsUpDown size={14} className="opacity-30" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
          {sorted.map((row) => (
            <tr
              key={keyExtractor(row)}
              className={cn(
                onRowClick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800',
              )}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    compact ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-sm',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**How features use DataTable (zero custom table markup):**

```tsx
// features/trips/components/TripTable.tsx
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { StateBadge } from '@/components/ui/StateBadge';
import { tripStates } from '@/lib/fsm';
import type { Trip } from '@/types/trip';

const columns: Column<Trip>[] = [
  {
    key: 'date',
    header: 'Date',
    render: (trip) => formatDate(trip.startTime),
    sortable: true,
    sortFn: (a, b) => a.startTime.localeCompare(b.startTime),
  },
  {
    key: 'distance',
    header: 'Distance',
    render: (trip) => `${trip.distance.toFixed(1)} mi`,
    sortable: true,
    sortFn: (a, b) => a.distance - b.distance,
    align: 'right',
  },
  {
    key: 'efficiency',
    header: 'Efficiency',
    render: (trip) => `${trip.efficiency} Wh/mi`,
    align: 'right',
  },
  {
    key: 'state',
    header: 'State',
    render: (trip) => <StateBadge config={tripStates[trip.fsmState]} />,
  },
];

export function TripTable({ trips }: { trips: Trip[] }) {
  const navigate = useNavigate();
  return (
    <DataTable
      columns={columns}
      data={trips}
      keyExtractor={(t) => t.id}
      onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
      stickyHeader
    />
  );
}
```

#### 4.2.5 Chart Components (`components/charts/`)

Wrappers around Recharts that enforce consistent styling, dark mode, and responsive behavior.

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `ChartContainer` | `charts/ChartContainer.tsx` | `title`, `subtitle`, `loading`, `empty`, `height`, `children` | Standard chart frame with loading/empty states |
| `TimeSeriesChart` | `charts/TimeSeriesChart.tsx` | `data`, `xKey`, `series[]`, `height`, `timeRange` | Line/area chart for time-based data |
| `BarChart` | `charts/BarChart.tsx` | `data`, `xKey`, `series[]`, `stacked`, `horizontal` | Categorical bar chart |
| `GaugeChart` | `charts/GaugeChart.tsx` | `value`, `max`, `label`, `thresholds[]` | Battery level, efficiency gauge |
| `PieChart` | `charts/PieChart.tsx` | `data: {label, value, color}[]`, `donut` | Distribution/breakdown |

```tsx
// components/charts/ChartContainer.tsx
import { Card, CardHeader } from '@/components/ui/Card';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  children: React.ReactNode;
}

export function ChartContainer({
  title, subtitle, action, loading, empty, height = 300, children,
}: ChartContainerProps) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div style={{ height }}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="md" />
          </div>
        ) : empty ? (
          <EmptyState message="No data available for this period." />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

// components/charts/TimeSeriesChart.tsx
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

interface Series {
  key: string;
  label: string;
  color: string;
  type?: 'line' | 'area';
}

interface TimeSeriesChartProps<T> {
  data: T[];
  xKey: keyof T & string;
  series: Series[];
  xFormatter?: (value: string) => string;
  yFormatter?: (value: number) => string;
}

export function TimeSeriesChart<T>({ data, xKey, series, xFormatter, yFormatter }: TimeSeriesChartProps<T>) {
  const theme = useChartTheme();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
        <XAxis dataKey={xKey} tickFormatter={xFormatter} stroke={theme.axisColor} fontSize={12} />
        <YAxis tickFormatter={yFormatter} stroke={theme.axisColor} fontSize={12} />
        <Tooltip
          contentStyle={{ backgroundColor: theme.tooltipBg, border: 'none', borderRadius: 8 }}
          labelFormatter={xFormatter}
          formatter={(value: number, name: string) => [yFormatter?.(value) ?? value, name]}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

**Feature usage — zero raw Recharts imports in feature code:**

```tsx
// features/charging/components/ChargingPowerChart.tsx
import { ChartContainer } from '@/components/charts/ChartContainer';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useChargingTimeline } from '@/api/hooks/useCharging';

export function ChargingPowerChart({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useChargingTimeline(sessionId);

  return (
    <ChartContainer title={t('charging.powerChart')} loading={isLoading} empty={!data?.length}>
      <TimeSeriesChart
        data={data ?? []}
        xKey="timestamp"
        series={[
          { key: 'powerKw', label: 'Power (kW)', color: '#3b82f6' },
          { key: 'batteryLevel', label: 'Battery (%)', color: '#22c55e' },
        ]}
        xFormatter={(ts) => formatTime(ts)}
        yFormatter={(v) => `${v.toFixed(1)}`}
      />
    </ChartContainer>
  );
}
```

#### 4.2.6 Map Components (`components/maps/`)

Wrappers around Leaflet that handle tile layers, dark mode, and clustering.

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `MapContainer` | `maps/MapContainer.tsx` | `center`, `zoom`, `height`, `children`, `className` | Base map with tile layer |
| `MapMarker` | `maps/MapMarker.tsx` | `position`, `icon`, `popup`, `tooltip` | Marker with custom icon |
| `MapRoute` | `maps/MapRoute.tsx` | `positions`, `color`, `weight`, `animated` | Polyline route |
| `MapCluster` | `maps/MapCluster.tsx` | `children` (MapMarkers) | Marker clustering |
| `MapBounds` | `maps/MapBounds.tsx` | `bounds`, `padding` | Auto-fit map to content |

```tsx
// features/trips/components/TripMapView.tsx — COMPOSES shared map components
import { MapContainer } from '@/components/maps/MapContainer';
import { MapRoute } from '@/components/maps/MapRoute';
import { MapMarker } from '@/components/maps/MapMarker';
import { MapBounds } from '@/components/maps/MapBounds';

export function TripMapView({ trip }: { trip: Trip }) {
  return (
    <MapContainer height={400}>
      <MapRoute positions={trip.routePoints} color="#3b82f6" weight={4} />
      <MapMarker position={trip.startLocation} icon="start" popup="Trip start" />
      <MapMarker position={trip.endLocation} icon="end" popup="Trip end" />
      <MapBounds bounds={trip.routePoints} padding={[20, 20]} />
    </MapContainer>
  );
}
```

#### 4.2.7 Form Components (`components/forms/`)

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `FormField` | `forms/FormField.tsx` | `label`, `error`, `required`, `hint`, `children` | Wraps any input with label + error |
| `FormSection` | `forms/FormSection.tsx` | `title`, `description`, `children` | Groups related form fields |
| `SearchInput` | `forms/SearchInput.tsx` | `value`, `onChange`, `placeholder`, `debounceMs` | Search with built-in debounce |
| `DateRangePicker` | `forms/DateRangePicker.tsx` | `from`, `to`, `onChange`, `presets` | Date range selection with presets |
| `NumberInput` | `forms/NumberInput.tsx` | `value`, `onChange`, `min`, `max`, `step`, `unit` | Numeric input with unit label |

```tsx
// components/forms/SearchInput.tsx
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', debounceMs = 300 }: SearchInputProps) {
  const [internal, setInternal] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => onChange(internal), debounceMs);
    return () => clearTimeout(timer);
  }, [internal, debounceMs, onChange]);

  useEffect(() => { setInternal(value); }, [value]);

  return (
    <Input
      value={internal}
      onChange={(e) => setInternal(e.target.value)}
      placeholder={placeholder}
      icon={<Search size={16} />}
      suffix={internal && (
        <button onClick={() => { setInternal(''); onChange(''); }} className="p-1">
          <X size={14} />
        </button>
      )}
    />
  );
}
```

#### 4.2.8 Animation Components (`components/motion/`)

Wrappers around Framer Motion for consistent, reusable animations.

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `FadeIn` | `motion/FadeIn.tsx` | `delay`, `duration`, `children` | Fade-in on mount |
| `SlideIn` | `motion/SlideIn.tsx` | `from` (left/right/top/bottom), `delay`, `children` | Slide in from direction |
| `AnimatedList` | `motion/AnimatedList.tsx` | `children`, `staggerDelay` | Staggered list animation |
| `AnimatedNumber` | `motion/AnimatedNumber.tsx` | `value`, `duration`, `format` | Counting number animation |
| `Collapse` | `motion/Collapse.tsx` | `open`, `children` | Animated height expand/collapse |

```tsx
// components/motion/AnimatedList.tsx
import { motion, AnimatePresence } from 'framer-motion';

interface AnimatedListProps {
  children: React.ReactNode[];
  staggerDelay?: number;
}

export function AnimatedList({ children, staggerDelay = 0.05 }: AnimatedListProps) {
  return (
    <AnimatePresence>
      {children.map((child, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ delay: i * staggerDelay, duration: 0.2 }}
        >
          {child}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
```

### 4.3 Component Design Patterns

#### 4.3.1 Composition Over Configuration

**Rule: Build complex UIs by composing small components, not by adding ever more props to a single component.**

```tsx
// BAD — "kitchen sink" component with 20 props
<Card
  title="My Tesla"
  subtitle="Model 3"
  image="/tesla.jpg"
  badge="Online"
  badgeColor="green"
  showActions={true}
  onRefresh={handleRefresh}
  onNavigate={handleNav}
  stat1Label="Battery"
  stat1Value="80%"
  stat2Label="Range"
  stat2Value="250 mi"
  loading={false}
/>

// GOOD — composed from small, reusable pieces
<Card>
  <CardHeader
    title="My Tesla"
    subtitle="Model 3"
    action={<StateBadge config={vehicleStates.online} />}
  />
  <div className="flex gap-4">
    <Metric label="Battery" value="80%" />
    <Metric label="Range" value="250 mi" />
  </div>
  <div className="flex gap-2 mt-4">
    <Button variant="outline" size="sm" onClick={handleRefresh}>Refresh</Button>
    <Button variant="ghost" size="sm" onClick={handleNav}>Details</Button>
  </div>
</Card>
```

#### 4.3.2 Compound Components

For components with tightly related parts, use the compound component pattern.

```tsx
// components/ui/Card.tsx — compound component pattern
export function Card({ children, className, ...props }: CardProps) {
  return (
    <div className={cn('rounded-lg border bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800', className)} {...props}>
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mt-4 flex items-center justify-end gap-2 border-t pt-4 dark:border-gray-700', className)}>
      {children}
    </div>
  );
}

// Attach sub-components
Card.Header = CardHeader;
Card.Footer = CardFooter;

// Usage
<Card>
  <Card.Header title="Charging Session" action={<Badge variant="success">Active</Badge>} />
  <p>Session details here...</p>
  <Card.Footer>
    <Button variant="outline" size="sm">Stop</Button>
  </Card.Footer>
</Card>
```

#### 4.3.3 Polymorphic `as` Prop

For components that need to render as different HTML elements or other components.

```tsx
// components/ui/Stack.tsx — polymorphic component
import { type ElementType, type ComponentPropsWithoutRef } from 'react';

type StackProps<T extends ElementType = 'div'> = {
  as?: T;
  direction?: 'row' | 'col';
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  align?: 'start' | 'center' | 'end' | 'stretch';
} & ComponentPropsWithoutRef<T>;

export function Stack<T extends ElementType = 'div'>({
  as, direction = 'col', gap = 4, align, className, ...props
}: StackProps<T>) {
  const Component = as ?? 'div';
  return (
    <Component
      className={cn(
        'flex',
        direction === 'col' ? 'flex-col' : 'flex-row',
        `gap-${gap}`,
        align && `items-${align}`,
        className,
      )}
      {...props}
    />
  );
}

// Usage
<Stack direction="row" gap={3} align="center">...</Stack>
<Stack as="nav" direction="col" gap={2}>...</Stack>
<Stack as="ul" direction="col" gap={1}>...</Stack>
```

#### 4.3.4 Slot Pattern for Extensible Layouts

**Rule: Use ReactNode "slot" props for extensible layout regions instead of adding feature-specific props.**

```tsx
// GOOD — slot pattern
interface PageHeaderProps {
  title: string;
  breadcrumbs?: React.ReactNode;  // slot
  actions?: React.ReactNode;       // slot
  tabs?: React.ReactNode;          // slot
}

// Usage — features fill slots without modifying the shared component
<PageHeader
  title="Vehicles"
  breadcrumbs={<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Vehicles' }]} />}
  actions={
    <>
      <SearchInput value={search} onChange={setSearch} />
      <Button icon={<PlusIcon />}>Add Vehicle</Button>
    </>
  }
  tabs={<Tabs tabs={['All', 'Online', 'Charging', 'Offline']} activeTab={tab} onChange={setTab} />}
/>
```

### 4.4 Reusable Custom Hooks Library

Shared hooks live in `hooks/`. Feature-specific hooks live in `features/*/hooks/`.

| Hook | File | Purpose |
|------|------|---------|
| `useDebounce` | `hooks/useDebounce.ts` | Debounced value |
| `useLocalStorage` | `hooks/useLocalStorage.ts` | Persistent local state |
| `useMediaQuery` | `hooks/useMediaQuery.ts` | Responsive breakpoint detection |
| `useOnClickOutside` | `hooks/useOnClickOutside.ts` | Detect clicks outside a ref |
| `useInterval` | `hooks/useInterval.ts` | Safe interval with cleanup |
| `useChartTheme` | `hooks/useChartTheme.ts` | Dark/light theme colors for Recharts |
| `useCopyToClipboard` | `hooks/useCopyToClipboard.ts` | Clipboard with success feedback |
| `useKeyboardShortcut` | `hooks/useKeyboardShortcut.ts` | Register keyboard shortcuts |
| `usePagination` | `hooks/usePagination.ts` | Cursor-based pagination state |
| `useConfirm` | `hooks/useConfirm.ts` | Promise-based confirm dialog trigger |

```typescript
// hooks/useDebounce.ts
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// hooks/useMediaQuery.ts
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// Convenience breakpoint hooks
export const useIsMobile = () => useMediaQuery('(max-width: 639px)');
export const useIsTablet = () => useMediaQuery('(min-width: 640px) and (max-width: 1023px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
```

**Rule: Before creating a custom hook in `features/*/hooks/`, check if `hooks/` already has it.**

**Rule: If the same hook appears in 2+ features, promote it to `hooks/` immediately.**

### 4.5 Eliminating Duplicate UI Code

**Before creating ANY new component, follow this decision tree:**

```
Need a UI element?
  │
  ├─ Is it in components/ui/?           → USE IT
  ├─ Is it in components/data-display/? → USE IT
  ├─ Is it in components/charts/?       → USE IT
  ├─ Is it in components/maps/?         → USE IT
  ├─ Is it in components/feedback/?     → USE IT
  ├─ Is it in components/forms/?        → USE IT
  ├─ Is it in components/motion/?       → USE IT
  │
  ├─ Does another feature have a similar component?
  │   └─ YES → PROMOTE it to components/ first, then use it
  │
  ├─ Can an existing component be made more flexible with one more prop?
  │   └─ YES → Add the prop to the shared component (backward-compatible)
  │
  └─ None of the above?
      └─ Create it in features/*/components/ with a TODO comment:
         // TODO: promote to components/ if reused by another feature
```

**Promotion rule:** If the same UI pattern appears in **2+ features**, it MUST be extracted to
`components/` in the same PR or a follow-up PR linked in the review.

**Barrel exports — every component category has an index file:**

```typescript
// components/ui/index.ts
export { Button, type ButtonProps } from './Button';
export { Badge, type BadgeProps } from './Badge';
export { Card, type CardProps } from './Card';
export { Input, type InputProps } from './Input';
export { Modal, type ModalProps } from './Modal';
export { Select, type SelectProps } from './Select';
export { Tabs, type TabsProps } from './Tabs';
export { Toggle, type ToggleProps } from './Toggle';
export { Tooltip, type TooltipProps } from './Tooltip';
export { StateBadge, type StateBadgeProps } from './StateBadge';
// ... every ui component exported here

// Feature code imports from barrel:
import { Button, Badge, Card } from '@/components/ui';
```

### 4.6 Accessibility (a11y)

**Rule: Every shared component meets WCAG 2.1 AA. These are non-negotiable minimums.**

| Requirement | How We Enforce It |
|-------------|-------------------|
| **Keyboard navigable** | All interactive elements are focusable. `Modal` traps focus. `Tabs` supports arrow keys. |
| **ARIA attributes** | `Button` with `loading` sets `aria-busy`. `Modal` sets `aria-modal`, `role="dialog"`. `Badge` with status uses `aria-label`. |
| **Color contrast** | Tailwind color palette validated against AA contrast ratios. Never rely on color alone — pair with icons/text. |
| **Screen reader text** | `IconButton` requires `label` prop (rendered as `aria-label`). |
| **Reduced motion** | All Framer Motion components respect `prefers-reduced-motion`. |
| **Error announcements** | Form errors use `aria-describedby` linking input to error message. |

```tsx
// components/ui/IconButton.tsx — label prop is REQUIRED for a11y
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;        // ← mandatory, used as aria-label & tooltip content
  variant?: 'ghost' | 'outline';
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant = 'ghost', size = 'md', className, ...props }, ref) => (
    <Tooltip content={label}>
      <button
        ref={ref}
        aria-label={label}
        className={cn(/* ... */)}
        {...props}
      >
        {icon}
      </button>
    </Tooltip>
  ),
);
```

### 4.7 Performance Patterns

| Pattern | When to Use | How |
|---------|-------------|-----|
| `React.memo` | Expensive renders in lists (e.g., `VehicleCard` in a grid of 20+) | `export const VehicleCard = React.memo(VehicleCardInner)` |
| `React.lazy` + `Suspense` | Route-level code splitting. Heavy features (maps, charts) | `const TripMap = React.lazy(() => import('./TripMap'))` |
| `useMemo` / `useCallback` | Derived data, callback refs passed to memoized children | Only when profiler shows re-render cost |
| Virtualization | Lists with 100+ items (telemetry logs, long trip lists) | `@tanstack/react-virtual` |
| Image lazy loading | Vehicle images, map tiles | Native `loading="lazy"` on `<img>` |
| Bundle splitting | Per-feature chunks in Vite | Vite's `manualChunks` in `vite.config.ts` |

**Rule: Don't prematurely optimize. Profile first with React DevTools Profiler. Optimize only measured bottlenecks.**

```tsx
// Route-level code splitting — each feature is a separate chunk
// routes/index.tsx
import { lazy, Suspense } from 'react';
import { Spinner } from '@/components/feedback/Spinner';

const VehiclesPage = lazy(() => import('@/features/vehicles/pages/VehicleListPage'));
const ChargingPage = lazy(() => import('@/features/charging/pages/ChargingListPage'));
const TripsPage    = lazy(() => import('@/features/trips/pages/TripListPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/pages/DashboardPage'));
const SettingsPage  = lazy(() => import('@/features/settings/pages/SettingsPage'));

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Spinner size="lg" label="Loading…" />}>{children}</Suspense>;
}

// In route definitions
<Route path="/vehicles" element={<LazyRoute><VehiclesPage /></LazyRoute>} />
```

### 4.8 API Layer — Single Source of Truth

**Rule: All HTTP communication goes through `api/client.ts`. No `fetch()` or `axios` calls in components.**

```typescript
// api/client.ts — the ONLY place that knows about the base URL, auth headers, error handling
import ky from 'ky';  // or plain fetch wrapper

export const apiClient = ky.create({
  prefixUrl: import.meta.env.VITE_API_URL ?? '/api',
  hooks: {
    beforeRequest: [
      (request) => {
        const token = getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          // Trigger re-auth flow
        }
      },
    ],
  },
});
```

**Rule: Every API endpoint gets exactly one TanStack Query hook in `api/hooks/`.**

```typescript
// api/hooks/useVehicles.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import type { Vehicle } from '@/types/vehicle';

// Query keys — centralized to avoid key duplication
export const vehicleKeys = {
  all:    ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
  state:  (id: string) => ['vehicles', id, 'state'] as const,
};

export function useVehicles() {
  return useQuery({
    queryKey: vehicleKeys.all,
    queryFn: () => apiClient.get('v1/vehicles').json<Vehicle[]>(),
    staleTime: 30_000,
  });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: () => apiClient.get(`v1/vehicles/${id}`).json<Vehicle>(),
    enabled: !!id,
  });
}

export function useRefreshVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`v1/vehicles/${id}/refresh`).json<Vehicle>(),
    onSuccess: (data, id) => {
      queryClient.setQueryData(vehicleKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
  });
}
```

**Why this matters:** Without centralized query keys, cache invalidation becomes unpredictable. Without a single API client, auth logic gets duplicated, error handling is inconsistent, and base URLs are hardcoded in random places.

### 4.9 TypeScript Strictness

**`tsconfig.json` required settings:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Rule: No `any`. Use `unknown` when the type is truly not known, then narrow.**

```typescript
// BAD
function processResponse(data: any) { return data.vehicles; }

// GOOD
function processResponse(data: unknown): Vehicle[] {
  if (!isVehicleListResponse(data)) {
    throw new Error('Unexpected response shape');
  }
  return data.vehicles;
}
```

**Rule: API response types live in `types/` and are shared between hooks and components.**

### 4.10 State Management

| State Type | Where It Lives | Tool |
|------------|---------------|------|
| **Server state** (vehicles, trips, charging) | TanStack Query cache | `useQuery` / `useMutation` |
| **URL state** (filters, pagination, selected tab) | URL search params | `useSearchParams` / React Router |
| **UI state** (modal open, sidebar collapsed) | Component-local `useState` | React `useState` |
| **Form state** | Form-local | `react-hook-form` or controlled inputs |
| **Global client state** | Only if truly global (theme, locale) | React Context (not Redux) |

**Rule: Do NOT duplicate server state in `useState`. Use TanStack Query as the cache.**

```tsx
// BAD — duplicates server state, goes stale
const [vehicles, setVehicles] = useState<Vehicle[]>([]);
useEffect(() => {
  fetch('/api/v1/vehicles').then(r => r.json()).then(setVehicles);
}, []);

// GOOD — single source of truth, auto-refetch, caching
const { data: vehicles, isLoading, error } = useVehicles();
```

### 4.11 Styling with Tailwind

**Rule: No inline `style={{}}` props except for truly dynamic values (e.g., chart dimensions).**

**Rule: Extract repeated Tailwind class combinations into reusable components, not utility classes.**

```tsx
// BAD — same classes copy-pasted in 12 places
<div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">

// GOOD — extract to a Card component
// components/ui/Card.tsx
export function Card({ children, className }: CardProps) {
  return (
    <div className={cn(
      'rounded-lg border border-gray-200 bg-white p-4 shadow-sm',
      'dark:border-gray-700 dark:bg-gray-800',
      className
    )}>
      {children}
    </div>
  );
}
```

### 4.12 Internationalization (i18n)

**Rule: No hardcoded user-facing strings in components. Use `useTranslation` from i18next.**

```tsx
// BAD
<h1>Vehicle Dashboard</h1>
<p>No vehicles found. Add your first Tesla to get started.</p>

// GOOD
const { t } = useTranslation('vehicles');
<h1>{t('dashboard.title')}</h1>
<p>{t('dashboard.empty')}</p>
```

**Rule: Translation keys use dot-separated namespaces matching the feature structure.**

---

## 5. Database & Data-Access Patterns

### 5.1 PostgreSQL (Primary)

**Migration rules:**

| Rule | Details |
|------|---------|
| Every migration has both `.up.sql` and `.down.sql` | Rollbacks must work. |
| Migrations are **append-only** in production | Never edit a migration that has been applied to any environment. Create a new one. |
| Use `IF NOT EXISTS` / `IF EXISTS` guards | Makes migrations idempotent and safe to re-run. |
| Migrations MUST be reviewed for lock safety | Avoid `ALTER TABLE ... ADD COLUMN ... DEFAULT x` on large tables (acquires ACCESS EXCLUSIVE lock in PG < 11). Use `ADD COLUMN` then `UPDATE` in batches. |
| Index creation uses `CONCURRENTLY` | Prevents blocking reads during index builds. |

**Schema conventions:**

```sql
-- Primary keys: UUIDv7 (time-sortable) generated by the application, not serial/bigserial
-- Timestamps: always `timestamptz`, never `timestamp`
-- Soft deletes: use `deleted_at timestamptz` column, never physically delete user data
-- Naming: snake_case for tables and columns, plural table names (vehicles, trips, charging_sessions)
```

**Connection pool (pgx):**

```go
// Tuned for Kubernetes pod — not too many connections
poolConfig.MaxConns = 20           // Per pod. Total = pods × 20.
poolConfig.MinConns = 5
poolConfig.MaxConnLifetime = 30 * time.Minute
poolConfig.MaxConnIdleTime = 5 * time.Minute
poolConfig.HealthCheckPeriod = 1 * time.Minute
```

### 5.2 Redis (Cache)

**Rule: Redis is a cache, not a database. Every cached value must have a TTL. The system must function (degraded) if Redis is unavailable.**

**Key naming convention:**

```
teslasync:{entity}:{id}:{subresource}
```

Examples:
```
teslasync:vehicle:abc123:state        TTL 30s
teslasync:vehicle:abc123:location     TTL 15s
teslasync:user:def456:preferences     TTL 5m
teslasync:charging:session:ghi789     TTL 1m
```

**Rule: Cache-aside pattern (read-through) is the default. No write-through unless explicitly documented.**

```go
func (c *vehicleCache) GetState(ctx context.Context, id string) (*vehicle.State, error) {
    key := fmt.Sprintf("teslasync:vehicle:%s:state", id)

    // Try cache first
    val, err := c.client.Get(ctx, key).Bytes()
    if err == nil {
        var state vehicle.State
        if err := json.Unmarshal(val, &state); err == nil {
            return &state, nil
        }
    }

    // Cache miss — return nil, caller fetches from source and populates cache
    return nil, nil
}
```

### 5.3 MongoDB (Telemetry)

**Rule: MongoDB is ONLY used for raw Fleet Telemetry ingestion with 7-day TTL. It is NOT a general-purpose store.**

- Collection: `raw_telemetry`
- TTL index on `received_at` field (604800 seconds = 7 days)
- Documents are append-only. Never update telemetry documents.
- Processed/aggregated data goes to PostgreSQL.

### 5.4 Query Performance Monitoring

**Rule: Every environment (dev, staging, prod) has `pg_stat_statements` enabled.**

| Standard | Target |
|----------|--------|
| Query time budget: simple lookups (by PK / index) | < 5 ms p95 |
| Query time budget: aggregations / reports | < 200 ms p95 |
| Max queries per HTTP request | ≤ 10 (use JOINs or batch, not N+1) |
| Slow-query log threshold | 100 ms |
| `auto_explain` threshold | 200 ms (logs EXPLAIN ANALYZE for slow queries) |
| Query plan review | Required in PR for new queries touching tables > 100k rows |
| Dashboard | Grafana → pg_stat_statements datasource, refreshed every 30s |

```sql
-- Required Postgres extensions (managed in migration 000001)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram indexes for search
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
```

**Rule: Every new query must have an `EXPLAIN ANALYZE` run pasted in the PR description for tables > 10k rows.**

### 5.5 Index Strategy

| Index Type | When to Use | Example |
|------------|-------------|---------|
| B-tree (default) | Equality, range, ORDER BY | `idx_vehicles_user_id` |
| Partial | Filter on common subset | `CREATE INDEX idx_trips_active ON trips (vehicle_id) WHERE deleted_at IS NULL` |
| Covering (INCLUDE) | Avoid heap lookup for frequent queries | `CREATE INDEX idx_vehicles_vin ON vehicles (vin) INCLUDE (display_name, fsm_state)` |
| GIN | JSONB, array columns, full-text search | `CREATE INDEX idx_telemetry_data ON raw_signals USING GIN (data)` |
| Composite | Multi-column lookups | `CREATE INDEX idx_charging_vehicle_time ON charging_sessions (vehicle_id, started_at DESC)` |

**Rules:**
- Every foreign key column must have an index (prevent sequential scans on JOIN).
- Every column used in `WHERE`, `ORDER BY`, or `JOIN` on tables > 10k rows must have an index or a documented reason not to.
- Unused indexes are detected via `pg_stat_user_indexes` (idx_scan = 0) and cleaned quarterly.
- All index creation in migrations uses `CREATE INDEX CONCURRENTLY` (non-blocking).

### 5.6 VACUUM, ANALYZE & Maintenance

| Setting | Value | Rationale |
|---------|-------|-----------|
| `autovacuum` | ON (never disable) | Prevents table bloat and transaction ID wraparound |
| `autovacuum_vacuum_scale_factor` | 0.05 for large tables (default 0.20 too lazy) | Vacuum runs when 5% of rows are dead |
| `autovacuum_analyze_scale_factor` | 0.02 for large tables | Keep statistics fresh for planner |
| Bloat monitoring | `pgstattuple` extension, alerting at > 30% bloat | Grafana dashboard |
| Manual VACUUM FULL | Scheduled maintenance window only, with ADR | Rewrites entire table, takes exclusive lock |

### 5.7 Zero-Downtime Migration Strategy

**Rule: All migrations must be deployable without downtime using the expand–contract pattern.**

```
Phase 1: EXPAND (deploy N+1 code that handles both old and new schema)
  ├─ Add new column (nullable or with DEFAULT, non-locking in PG 11+)
  ├─ Add new table
  ├─ Add new index CONCURRENTLY
  ├─ Start dual-writing (write to both old and new columns)
  └─ Backfill new column in batches (not a single UPDATE)

Phase 2: MIGRATE (deploy N+2 code that reads from new schema)
  ├─ Switch reads to new column/table
  ├─ Verify data consistency
  └─ Remove dual-write if safe

Phase 3: CONTRACT (deploy N+3, cleanup old schema)
  ├─ Drop old column (only after all code versions stop reading it)
  ├─ Drop old index
  └─ VACUUM FULL if table bloat is significant (maintenance window)
```

**Irreversible migration policy:** Some migrations cannot be rolled back (data transforms, column drops). These require:
1. An ADR documenting the irreversibility
2. A pre-migration backup
3. Deployment during a low-traffic window
4. A runbook for manual rollback-by-restore if needed

### 5.8 Table Partitioning & Archival

| Table | Strategy | Partition Key | Retention |
|-------|----------|---------------|-----------|
| `fsm_transitions` | Range by `created_at` (monthly) | `created_at` | 12 months active, then archive to cold storage |
| `telemetry_signals` | Range by `received_at` (daily) | `received_at` | 90 days active |
| `audit_logs` | Range by `created_at` (monthly) | `created_at` | 24 months active (compliance) |
| `charging_sessions`, `trips` | No partitioning (moderate volume) | — | Soft delete, never purge user data |

```sql
-- Example: partitioned fsm_transitions
CREATE TABLE fsm_transitions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    -- ... other columns ...
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Monthly partitions created by a scheduled job or migration
CREATE TABLE fsm_transitions_2026_04
    PARTITION OF fsm_transitions
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

---

## 6. API Design & Contracts

### 6.1 REST Conventions

| Aspect | Convention |
|--------|-----------|
| Base path | `/api/v1/` |
| Resource naming | Plural nouns: `/vehicles`, `/trips`, `/charging-sessions` |
| IDs | Path params: `/vehicles/{vehicleID}` |
| Filtering | Query params: `/trips?from=2024-01-01&to=2024-01-31&vehicleId=abc` |
| Pagination | Cursor-based: `?cursor=xyz&limit=50` (prefer over offset for large sets) |
| Sorting | `?sort=created_at&order=desc` |
| Versioning | URL path: `/api/v1/`, `/api/v2/` |
| Content-Type | `application/json` for all request/response bodies |

### 6.2 Response Envelope

```json
// Success (single resource)
{
  "data": { "id": "abc", "vin": "5YJ3E...", "displayName": "My Tesla" }
}

// Success (collection)
{
  "data": [...],
  "pagination": {
    "cursor": "eyJpZCI6...",
    "hasMore": true,
    "totalCount": 142
  }
}

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid VIN format",
    "details": [
      { "field": "vin", "message": "must be 17 characters" }
    ]
  }
}
```

**Rule: The response shape is defined ONCE in `internal/handler/dto/response.go` and reused across all handlers.**

### 6.3 Request Validation

**Rule: Validate at the handler layer before calling the service layer.**

```go
// internal/handler/dto/vehicle.go
type CreateVehicleRequest struct {
    VIN         string `json:"vin" validate:"required,len=17"`
    DisplayName string `json:"displayName" validate:"required,min=1,max=100"`
}

// Decode + validate in one helper (DRY)
func DecodeAndValidate[T any](r *http.Request) (T, error) {
    var req T
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        return req, fmt.Errorf("decode: %w", domain.ErrValidation)
    }
    if err := validator.Struct(req); err != nil {
        return req, mapValidationErrors(err)
    }
    return req, nil
}
```

### 6.4 Rate Limiting

| Tier | Limit | Key | Response |
|------|-------|-----|----------|
| Global | 1000 req/min per API key | API key or JWT `sub` | `429 Too Many Requests` + `Retry-After` header |
| Per-endpoint (write) | 30 req/min | User + endpoint | `429` + `X-RateLimit-Remaining` header |
| Per-endpoint (read) | 300 req/min | User + endpoint | `429` + `X-RateLimit-Remaining` header |
| Tesla API proxy | 10 req/min per vehicle | VIN | `429` + human-readable message |

**Headers returned on every response:**
```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 247
X-RateLimit-Reset: 1713945600
```

**Implementation:** Redis sliding-window counter in middleware. Key: `ratelimit:{user_id}:{endpoint}:{window}`.

### 6.5 Idempotency

**Rule: Every state-mutating endpoint (POST, PUT, PATCH, DELETE) supports idempotency keys.**

```
Client sends: Idempotency-Key: <client-generated UUID>
Server behavior:
  1. Check Redis for existing result under this key
  2. If found → return cached response (same status, same body)
  3. If not found → execute, store result with 24h TTL, return response
```

**Implementation: `internal/handler/middleware/idempotency.go`.**

Required for: vehicle commands, charging session actions, export job creation, any financial calculation.

### 6.6 API Versioning & Backward Compatibility

**Additive (non-breaking) changes — allowed without version bump:**
- Adding a new optional field to a response body
- Adding a new endpoint
- Adding a new optional query parameter
- Adding a new enum value (if clients use `default` handling)

**Breaking changes — require a new API version (`/api/v2/`):**
- Removing or renaming a field
- Changing a field's type
- Changing error response codes for existing conditions
- Removing an endpoint
- Changing pagination behavior (cursor format, default sort)
- Making a previously optional field required

**Breaking change process:**
1. File an ADR with justification and migration plan
2. Implement new version alongside old version
3. Add `Sunset` and `Deprecation` headers to old version
4. Communicate timeline to all consumers (min 90 days)
5. Monitor old-version traffic; remove only when traffic ≈ 0

### 6.7 API Deprecation Policy

```
Deprecation-Header format:
  Deprecation: true
  Sunset: Sat, 01 Nov 2026 00:00:00 GMT
  Link: <https://docs.teslasync.dev/migration/v1-to-v2>; rel="successor-version"
```

| Phase | Duration | Action |
|-------|----------|--------|
| Announcement | Day 0 | Add `Deprecation` + `Sunset` headers. Update docs. Notify consumers. |
| Warning | Day 0–60 | Log deprecation warnings per-consumer. |
| Migration support | Day 0–90 | Both versions active. Assist migration. |
| Sunset | Day 90+ | Remove old version. Return `410 Gone` for old endpoints. |

### 6.8 OpenAPI Specification

**Rule: The OpenAPI 3.1 spec is the contract. It is generated from handler/DTO code and validated in CI.**

| Practice | Details |
|----------|---------|
| Spec location | `docs/api/openapi.yaml` (generated), committed to repo |
| Generation | `oapi-codegen` or annotation-based generation from Go types |
| CI validation | `openapi-diff` compares PR branch against main — flags breaking changes |
| Client generation | Frontend TypeScript types generated from spec via `openapi-typescript` |
| Contract testing | Generated types are imported by frontend — compile-time contract |

---

## 7. MQTT & Messaging

### 7.1 Topic Hierarchy

```
teslasync/vehicles/{vin}/telemetry          # Raw telemetry from Fleet Telemetry
teslasync/vehicles/{vin}/state              # Processed vehicle state
teslasync/vehicles/{vin}/commands/request    # Command requests
teslasync/vehicles/{vin}/commands/response   # Command responses
teslasync/system/health                      # System health heartbeat
```

### 7.2 Message Design

**Rule: All MQTT messages are JSON. Include metadata for tracing and deduplication.**

```json
{
  "id": "msg_01HZ...",
  "timestamp": "2024-03-15T10:30:00Z",
  "traceId": "abc123def456",
  "type": "vehicle.state.updated",
  "payload": { ... }
}
```

### 7.3 Signal Batching

**Rule: Batch telemetry signals into 5-second windows before processing. Do not process every individual MQTT message as a separate DB write.**

```go
// internal/adapter/mqtt/batcher.go
type SignalBatcher struct {
    interval time.Duration   // 5s default
    buffer   map[string][]Signal
    flush    func(ctx context.Context, signals map[string][]Signal) error
}
```

---

## 8. Finite State Machines (FSM & SubFSM)

TeslaSync models many domain processes as state machines — vehicle lifecycle, charging sessions,
trips, export jobs, and notifications. The current codebase has **scattered, inconsistent, and
duplicated state transition logic** — the single biggest source of bugs. This section establishes
a unified FSM framework that all domain processes must follow.

### 8.1 Why a Unified FSM Framework

| Problem in Current Code | How the FSM Framework Fixes It |
|-------------------------|-------------------------------|
| State transitions scattered across handlers, services, workers | All transitions defined in one place per aggregate (the FSM definition) |
| Invalid transitions silently ignored or produce corrupt data | Transitions validated before execution; invalid transitions return errors |
| Duplicated guard/condition checks in multiple code paths | Guards are registered once per transition, enforced by the engine |
| Side effects (notifications, API calls) tightly coupled to transitions | Side effects are registered as hooks (OnEnter, OnExit, OnTransition), decoupled from the FSM core |
| No audit trail of state changes | Every transition is logged, traced, and optionally persisted to a history table |
| SubFSMs (nested states) handled with ad-hoc `if` chains | First-class SubFSM support with proper lifecycle management |

### 8.2 Core FSM Types

All FSM types live in `internal/domain/fsm/`. This package has **zero external dependencies** —
it is pure domain logic.

```go
// internal/domain/fsm/types.go

// State represents a named state in the machine.
type State string

// Event represents a trigger that may cause a state transition.
type Event string

// Guard is a predicate that must return true for a transition to proceed.
// Guards receive the transition context and can inspect the entity being transitioned.
type Guard[T any] func(ctx context.Context, entity T, event Event) (bool, error)

// Action is a side-effect executed during a transition.
// Actions are NOT allowed to change the FSM state — they react to transitions.
type Action[T any] func(ctx context.Context, entity T, transition Transition) error

// Transition describes a single allowed state change.
type Transition struct {
    From  State
    Event Event
    To    State
}

// HookType defines when a hook fires relative to a transition.
type HookType int

const (
    BeforeTransition HookType = iota  // Fires before state change (can abort via error)
    AfterTransition                    // Fires after state change (cannot abort)
    OnEnterState                       // Fires when entering a state (any transition into it)
    OnExitState                        // Fires when leaving a state (any transition out of it)
)
```

### 8.3 FSM Definition — Declarative Transition Tables

**Rule: Every FSM is defined as a declarative transition table. No `if/else` or `switch` chains for state transitions.**

```go
// internal/domain/vehicle/fsm.go — Vehicle Lifecycle FSM

package vehicle

import "github.com/yourorg/teslasync/internal/domain/fsm"

// States
const (
    StateUnknown  fsm.State = "unknown"
    StateOnline   fsm.State = "online"
    StateAsleep   fsm.State = "asleep"
    StateDriving  fsm.State = "driving"
    StateCharging fsm.State = "charging"
    StateOffline  fsm.State = "offline"
)

// Events
const (
    EventWake        fsm.Event = "wake"
    EventSleep       fsm.Event = "sleep"
    EventStartDrive  fsm.Event = "start_drive"
    EventStopDrive   fsm.Event = "stop_drive"
    EventPlugIn      fsm.Event = "plug_in"
    EventUnplug      fsm.Event = "unplug"
    EventGoOffline   fsm.Event = "go_offline"
    EventComeOnline  fsm.Event = "come_online"
)

// NewVehicleFSM creates the vehicle lifecycle state machine definition.
func NewVehicleFSM() *fsm.Definition {
    return fsm.NewDefinition("vehicle_lifecycle").
        InitialState(StateUnknown).
        //
        // Transition table — THE source of truth for allowed state changes
        //
        // From          | Event          | To
        Transition(StateUnknown,  EventComeOnline, StateOnline).
        Transition(StateOnline,   EventStartDrive, StateDriving).
        Transition(StateOnline,   EventPlugIn,     StateCharging).
        Transition(StateOnline,   EventSleep,      StateAsleep).
        Transition(StateOnline,   EventGoOffline,  StateOffline).
        Transition(StateDriving,  EventStopDrive,  StateOnline).
        Transition(StateDriving,  EventPlugIn,     StateCharging).  // drive → charge directly
        Transition(StateCharging, EventUnplug,     StateOnline).
        Transition(StateAsleep,   EventWake,       StateOnline).
        Transition(StateAsleep,   EventGoOffline,  StateOffline).
        Transition(StateOffline,  EventComeOnline, StateOnline).
        //
        // Invalid transitions (any From+Event combo not listed above)
        // are automatically rejected by the engine with ErrInvalidTransition.
        Build()
}
```

### 8.4 FSM Engine

The engine validates transitions, enforces guards, and fires hooks. It does NOT persist state —
that's the repository's job.

```go
// internal/domain/fsm/engine.go

type Engine[T any] struct {
    definition *Definition
    guards     map[Transition][]Guard[T]
    hooks      map[HookType]map[State][]Action[T]
    transHooks map[Transition][]Action[T]  // per-transition hooks
    logger     zerolog.Logger
}

// NewEngine creates an FSM engine for a specific entity type.
func NewEngine[T any](def *Definition) *Engine[T] {
    return &Engine[T]{
        definition: def,
        guards:     make(map[Transition][]Guard[T]),
        hooks:      make(map[HookType]map[State][]Action[T]),
        transHooks: make(map[Transition][]Action[T]),
    }
}

// Fire attempts a state transition. Returns the new state or an error.
func (e *Engine[T]) Fire(ctx context.Context, entity T, currentState State, event Event) (State, error) {
    ctx, span := otel.Tracer("fsm").Start(ctx, "FSM.Fire",
        trace.WithAttributes(
            attribute.String("fsm.name", e.definition.Name),
            attribute.String("fsm.current_state", string(currentState)),
            attribute.String("fsm.event", string(event)),
        ))
    defer span.End()

    // 1. Look up transition
    transition, ok := e.definition.FindTransition(currentState, event)
    if !ok {
        return currentState, fmt.Errorf(
            "fsm %s: no transition from %s on event %s: %w",
            e.definition.Name, currentState, event, ErrInvalidTransition,
        )
    }

    // 2. Evaluate guards — ALL must pass
    for _, guard := range e.guards[transition] {
        allowed, err := guard(ctx, entity, event)
        if err != nil {
            return currentState, fmt.Errorf("fsm guard failed: %w", err)
        }
        if !allowed {
            return currentState, fmt.Errorf(
                "fsm %s: guard rejected transition %s → %s: %w",
                e.definition.Name, currentState, transition.To, ErrGuardRejected,
            )
        }
    }

    // 3. Fire OnExit hooks for current state
    if err := e.fireHooks(ctx, entity, OnExitState, currentState, transition); err != nil {
        return currentState, fmt.Errorf("fsm on_exit hook: %w", err)
    }

    // 4. Fire BeforeTransition hooks
    if err := e.fireTransitionHooks(ctx, entity, BeforeTransition, transition); err != nil {
        return currentState, fmt.Errorf("fsm before_transition hook: %w", err)
    }

    // 5. State change happens here (caller persists the new state)
    newState := transition.To

    // 6. Fire AfterTransition hooks
    if err := e.fireTransitionHooks(ctx, entity, AfterTransition, transition); err != nil {
        // Log but don't rollback — state has already changed
        e.logger.Error().Err(err).
            Str("fsm", e.definition.Name).
            Str("transition", fmt.Sprintf("%s→%s", currentState, newState)).
            Msg("after_transition hook failed")
    }

    // 7. Fire OnEnter hooks for new state
    if err := e.fireHooks(ctx, entity, OnEnterState, newState, transition); err != nil {
        e.logger.Error().Err(err).
            Str("fsm", e.definition.Name).
            Str("state", string(newState)).
            Msg("on_enter hook failed")
    }

    span.SetAttributes(attribute.String("fsm.new_state", string(newState)))
    return newState, nil
}
```

### 8.5 Guards — Conditional Transitions

Guards prevent transitions when preconditions aren't met. They are pure predicates — no side effects.

```go
// internal/domain/charging/guards.go

// CanStartCharging checks that the vehicle has a charger connection and battery < 100%.
func CanStartCharging(ctx context.Context, session *ChargingSession, event fsm.Event) (bool, error) {
    if session.Vehicle == nil {
        return false, fmt.Errorf("vehicle data required: %w", domain.ErrValidation)
    }
    return session.Vehicle.ChargerConnected && session.Vehicle.BatteryLevel < 100, nil
}

// CanCompleteCharging checks that we have valid energy data.
func CanCompleteCharging(ctx context.Context, session *ChargingSession, event fsm.Event) (bool, error) {
    return session.EnergyAdded > 0 && session.EndBatteryLevel >= session.StartBatteryLevel, nil
}

// Registration in the engine setup:
engine.AddGuard(fsm.Transition{From: StateIdle, Event: EventStartCharging, To: StateCharging},
    CanStartCharging)
engine.AddGuard(fsm.Transition{From: StateCharging, Event: EventComplete, To: StateCompleted},
    CanCompleteCharging)
```

### 8.6 Hooks — Decoupled Side Effects

Hooks execute side effects in response to state changes without coupling the FSM to external systems.

```go
// internal/app/chargingsvc/hooks.go

// OnEnterCharging starts telemetry collection for the session.
func (s *Service) OnEnterCharging(ctx context.Context, session *charging.ChargingSession, t fsm.Transition) error {
    log.Info().Str("session_id", session.ID).Msg("charging started, enabling telemetry capture")
    return s.telemetryCollector.StartCapture(ctx, session.VehicleID, session.ID)
}

// OnExitCharging stops telemetry collection.
func (s *Service) OnExitCharging(ctx context.Context, session *charging.ChargingSession, t fsm.Transition) error {
    return s.telemetryCollector.StopCapture(ctx, session.VehicleID, session.ID)
}

// OnEnterCompleted sends a notification and calculates cost.
func (s *Service) OnEnterCompleted(ctx context.Context, session *charging.ChargingSession, t fsm.Transition) error {
    if err := s.costCalculator.Calculate(ctx, session); err != nil {
        return fmt.Errorf("calculating cost: %w", err)
    }
    // Fire-and-forget notification — don't block the transition
    go s.notifier.NotifyChargingComplete(context.Background(), session)
    return nil
}

// Registration:
engine.OnEnter(charging.StateCharging, s.OnEnterCharging)
engine.OnExit(charging.StateCharging, s.OnExitCharging)
engine.OnEnter(charging.StateCompleted, s.OnEnterCompleted)
```

### 8.7 SubFSMs — Nested State Machines

SubFSMs model detailed behavior within a parent state. When the parent FSM enters a state that
has a SubFSM, the sub-machine is activated. When the parent exits that state, the SubFSM is
deactivated and reset.

**Rule: SubFSMs are used when a parent state has its own internal lifecycle with multiple sub-states.**

```
┌─────────────────── Vehicle Lifecycle FSM ───────────────────────┐
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ Unknown  │───▶│  Online  │───▶│ Driving  │───▶│  Online  │  │
│  └──────────┘    └──────────┘    └─────┬─────┘    └──────────┘  │
│                       │                │                         │
│                       ▼                │                         │
│                  ┌──────────┐          │                         │
│                  │ Charging │◀─────────┘                         │
│                  └─────┬─────┘                                   │
│                        │                                         │
│         ┌──────────────┼──────────────┐                         │
│         │  Charging SubFSM            │                         │
│         │                             │                         │
│         │  ┌────────┐   ┌─────────┐   │                         │
│         │  │Starting│──▶│Ramping  │   │                         │
│         │  └────────┘   └────┬────┘   │                         │
│         │                    ▼        │                         │
│         │  ┌─────────┐  ┌────────┐   │                         │
│         │  │Tapering │◀─│Steady  │   │                         │
│         │  └─────┬───┘  └────────┘   │                         │
│         │        ▼                    │                         │
│         │  ┌──────────┐              │                         │
│         │  │ Complete │              │                         │
│         │  └──────────┘              │                         │
│         └─────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────┘
```

**SubFSM definition:**

```go
// internal/domain/charging/sub_fsm.go — Charging Phase SubFSM

package charging

import "github.com/yourorg/teslasync/internal/domain/fsm"

// Sub-states within the "Charging" parent state
const (
    SubStateStarting fsm.State = "charging.starting"   // Handshake with charger
    SubStateRamping  fsm.State = "charging.ramping"     // Power ramping up
    SubStateSteady   fsm.State = "charging.steady"      // Stable charge rate
    SubStateTapering fsm.State = "charging.tapering"    // Reducing current near full
    SubStateComplete fsm.State = "charging.complete"    // Charge target reached
)

// Sub-events
const (
    SubEventHandshakeOK  fsm.Event = "handshake_ok"
    SubEventRampComplete fsm.Event = "ramp_complete"
    SubEventTaperStart   fsm.Event = "taper_start"
    SubEventTargetHit    fsm.Event = "target_hit"
    SubEventError        fsm.Event = "charge_error"
)

func NewChargingSubFSM() *fsm.Definition {
    return fsm.NewDefinition("charging_phase").
        InitialState(SubStateStarting).
        Transition(SubStateStarting, SubEventHandshakeOK, SubStateRamping).
        Transition(SubStateRamping,  SubEventRampComplete, SubStateSteady).
        Transition(SubStateSteady,   SubEventTaperStart,   SubStateTapering).
        Transition(SubStateTapering, SubEventTargetHit,     SubStateComplete).
        // Error from any active state → triggers parent FSM event
        Transition(SubStateStarting, SubEventError, SubStateComplete).
        Transition(SubStateRamping,  SubEventError, SubStateComplete).
        Transition(SubStateSteady,   SubEventError, SubStateComplete).
        Transition(SubStateTapering, SubEventError, SubStateComplete).
        Build()
}
```

**SubFSM registration on the parent engine:**

```go
// internal/domain/vehicle/fsm_setup.go

func SetupVehicleFSM() *fsm.Engine[*Vehicle] {
    def := NewVehicleFSM()
    engine := fsm.NewEngine[*Vehicle](def)

    // Register SubFSM: when the parent enters StateCharging,
    // the charging SubFSM is activated with its own transitions.
    chargingSubDef := charging.NewChargingSubFSM()
    engine.RegisterSubFSM(StateCharging, chargingSubDef, fsm.SubFSMConfig{
        // When the SubFSM reaches a terminal state, fire this event on the parent
        TerminalStates:  []fsm.State{charging.SubStateComplete},
        OnTerminalEvent: EventUnplug,
        // When the parent exits StateCharging, the SubFSM is deactivated
        ResetOnExit: true,
    })

    return engine
}
```

### 8.8 SubFSM Engine Support

```go
// internal/domain/fsm/sub_fsm.go

// SubFSMConfig configures how a SubFSM relates to its parent state.
type SubFSMConfig struct {
    // TerminalStates lists SubFSM states that signal completion to the parent.
    TerminalStates []State
    // OnTerminalEvent is the event fired on the PARENT engine when the SubFSM
    // reaches a terminal state. Enables automatic parent state progression.
    OnTerminalEvent Event
    // ResetOnExit: if true, SubFSM resets to its initial state when the parent
    // exits the state that owns this SubFSM.
    ResetOnExit bool
}

// SubFSMInstance tracks the runtime state of an active SubFSM.
type SubFSMInstance struct {
    Definition   *Definition
    Config       SubFSMConfig
    CurrentState State
    Active       bool
}

// RegisterSubFSM attaches a SubFSM to a specific parent state.
func (e *Engine[T]) RegisterSubFSM(parentState State, subDef *Definition, config SubFSMConfig) {
    e.subFSMs[parentState] = &SubFSMInstance{
        Definition:   subDef,
        Config:       config,
        CurrentState: subDef.InitialState,
        Active:       false,
    }

    // Auto-activate SubFSM when entering the parent state
    e.OnEnter(parentState, func(ctx context.Context, entity T, t Transition) error {
        sub := e.subFSMs[parentState]
        sub.Active = true
        sub.CurrentState = sub.Definition.InitialState
        log.Debug().
            Str("parent_state", string(parentState)).
            Str("sub_fsm", sub.Definition.Name).
            Str("sub_initial", string(sub.CurrentState)).
            Msg("SubFSM activated")
        return nil
    })

    // Auto-deactivate SubFSM when exiting the parent state
    e.OnExit(parentState, func(ctx context.Context, entity T, t Transition) error {
        sub := e.subFSMs[parentState]
        if sub.Active && config.ResetOnExit {
            sub.Active = false
            sub.CurrentState = sub.Definition.InitialState
            log.Debug().
                Str("parent_state", string(parentState)).
                Str("sub_fsm", sub.Definition.Name).
                Msg("SubFSM deactivated and reset")
        }
        return nil
    })
}

// FireSub attempts a state transition within an active SubFSM.
// If the SubFSM reaches a terminal state, it fires the configured event on the parent.
func (e *Engine[T]) FireSub(
    ctx context.Context,
    entity T,
    parentState State,
    subEvent Event,
) (State, error) {
    sub, ok := e.subFSMs[parentState]
    if !ok {
        return "", fmt.Errorf("no SubFSM registered for state %s: %w", parentState, ErrNoSubFSM)
    }
    if !sub.Active {
        return "", fmt.Errorf("SubFSM for state %s is not active: %w", parentState, ErrSubFSMInactive)
    }

    ctx, span := otel.Tracer("fsm").Start(ctx, "SubFSM.Fire",
        trace.WithAttributes(
            attribute.String("fsm.parent_state", string(parentState)),
            attribute.String("fsm.sub_name", sub.Definition.Name),
            attribute.String("fsm.sub_current", string(sub.CurrentState)),
            attribute.String("fsm.sub_event", string(subEvent)),
        ))
    defer span.End()

    transition, ok := sub.Definition.FindTransition(sub.CurrentState, subEvent)
    if !ok {
        return sub.CurrentState, fmt.Errorf(
            "SubFSM %s: no transition from %s on event %s: %w",
            sub.Definition.Name, sub.CurrentState, subEvent, ErrInvalidTransition,
        )
    }

    sub.CurrentState = transition.To
    span.SetAttributes(attribute.String("fsm.sub_new_state", string(sub.CurrentState)))

    // Check if SubFSM reached a terminal state → bubble up to parent
    for _, terminal := range sub.Config.TerminalStates {
        if sub.CurrentState == terminal {
            log.Info().
                Str("sub_fsm", sub.Definition.Name).
                Str("terminal_state", string(terminal)).
                Str("parent_event", string(sub.Config.OnTerminalEvent)).
                Msg("SubFSM reached terminal state, firing parent event")

            // Fire the parent transition
            _, err := e.Fire(ctx, entity, parentState, sub.Config.OnTerminalEvent)
            return sub.CurrentState, err
        }
    }

    return sub.CurrentState, nil
}
```

### 8.9 FSM State Persistence

**Rule: FSM state is persisted as a column on the aggregate's DB row. State history is persisted to a dedicated history table for auditability.**

```sql
-- Aggregate table stores the current state
ALTER TABLE vehicles ADD COLUMN fsm_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE charging_sessions ADD COLUMN fsm_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE charging_sessions ADD COLUMN sub_fsm_state TEXT; -- nullable, only set when SubFSM active

-- History table for auditing all transitions
CREATE TABLE fsm_transitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,             -- 'vehicle', 'charging_session', 'trip', etc.
    entity_id       TEXT NOT NULL,             -- FK to the aggregate
    fsm_name        TEXT NOT NULL,             -- 'vehicle_lifecycle', 'charging_session', etc.
    from_state      TEXT NOT NULL,
    to_state        TEXT NOT NULL,
    event           TEXT NOT NULL,
    is_sub_fsm      BOOLEAN NOT NULL DEFAULT false,
    parent_state    TEXT,                       -- only for SubFSM transitions
    metadata        JSONB,                     -- guards evaluated, hook results, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_id        TEXT                        -- OpenTelemetry trace ID for correlation
);

CREATE INDEX idx_fsm_transitions_entity ON fsm_transitions (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_fsm_transitions_fsm ON fsm_transitions (fsm_name, created_at DESC);
```

```go
// internal/adapter/postgres/fsm_history.go

type FSMHistoryRepository struct {
    pool *pgxpool.Pool
}

func (r *FSMHistoryRepository) RecordTransition(ctx context.Context, record FSMTransitionRecord) error {
    _, err := r.pool.Exec(ctx, `
        INSERT INTO fsm_transitions (entity_type, entity_id, fsm_name, from_state, to_state, event, is_sub_fsm, parent_state, metadata, trace_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        record.EntityType, record.EntityID, record.FSMName,
        record.FromState, record.ToState, record.Event,
        record.IsSubFSM, record.ParentState, record.Metadata,
        trace.SpanContextFromContext(ctx).TraceID().String(),
    )
    return err
}
```

### 8.10 FSM Integration in Application Services

**Rule: The application service is the orchestrator. It loads the entity, fires the FSM event, persists the new state, and records the transition — all in a single transaction.**

```go
// internal/app/vehiclesvc/state_transitions.go

func (s *Service) HandleVehicleEvent(ctx context.Context, vehicleID string, event fsm.Event) error {
    ctx, span := otel.Tracer("vehiclesvc").Start(ctx, "HandleVehicleEvent")
    defer span.End()

    tx, err := s.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback(ctx)

    // 1. Load entity (with row lock to prevent concurrent transitions)
    vehicle, err := s.repo.WithTx(tx).GetByIDForUpdate(ctx, vehicleID)
    if err != nil {
        return fmt.Errorf("load vehicle: %w", err)
    }

    oldState := vehicle.FSMState

    // 2. Fire FSM event
    newState, err := s.fsmEngine.Fire(ctx, vehicle, vehicle.FSMState, event)
    if err != nil {
        return fmt.Errorf("fsm fire: %w", err)
    }

    // 3. Update entity state
    vehicle.FSMState = newState
    if err := s.repo.WithTx(tx).Save(ctx, vehicle); err != nil {
        return fmt.Errorf("save vehicle: %w", err)
    }

    // 4. Record transition history
    if err := s.fsmHistory.WithTx(tx).RecordTransition(ctx, FSMTransitionRecord{
        EntityType: "vehicle",
        EntityID:   vehicleID,
        FSMName:    "vehicle_lifecycle",
        FromState:  string(oldState),
        ToState:    string(newState),
        Event:      string(event),
    }); err != nil {
        return fmt.Errorf("record transition: %w", err)
    }

    return tx.Commit(ctx)
}

// HandleChargingSubEvent processes a SubFSM event within an active charging session
func (s *ChargingService) HandleChargingSubEvent(ctx context.Context, sessionID string, subEvent fsm.Event) error {
    tx, err := s.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback(ctx)

    session, err := s.repo.WithTx(tx).GetByIDForUpdate(ctx, sessionID)
    if err != nil {
        return fmt.Errorf("load session: %w", err)
    }

    oldSubState := session.SubFSMState

    // Fire the SubFSM event — may also trigger a parent transition
    newSubState, err := s.fsmEngine.FireSub(ctx, session, session.FSMState, subEvent)
    if err != nil {
        return fmt.Errorf("sub-fsm fire: %w", err)
    }

    session.SubFSMState = newSubState
    if err := s.repo.WithTx(tx).Save(ctx, session); err != nil {
        return fmt.Errorf("save session: %w", err)
    }

    // Record SubFSM transition
    if err := s.fsmHistory.WithTx(tx).RecordTransition(ctx, FSMTransitionRecord{
        EntityType:  "charging_session",
        EntityID:    sessionID,
        FSMName:     "charging_phase",
        FromState:   string(oldSubState),
        ToState:     string(newSubState),
        Event:       string(subEvent),
        IsSubFSM:    true,
        ParentState: string(session.FSMState),
    }); err != nil {
        return fmt.Errorf("record sub-transition: %w", err)
    }

    return tx.Commit(ctx)
}
```

### 8.11 TeslaSync FSM Catalog

Every state machine in the project is documented here. **Do not create a new FSM without adding it to this catalog.**

| FSM Name | Entity | Package | States | Has SubFSM? |
|----------|--------|---------|--------|-------------|
| `vehicle_lifecycle` | Vehicle | `domain/vehicle/` | unknown, online, asleep, driving, charging, offline | Yes — `charging_phase` |
| `charging_session` | ChargingSession | `domain/charging/` | pending, connecting, charging, completing, completed, failed | Yes — `charging_phase` (detailed charge curve) |
| `charging_phase` | (SubFSM) | `domain/charging/` | starting, ramping, steady, tapering, complete | No (leaf SubFSM) |
| `trip_lifecycle` | Trip | `domain/trip/` | started, in_progress, paused, completed, cancelled | No |
| `export_job` | ExportJob | `domain/export/` | queued, validating, processing, uploading, completed, failed | No |
| `notification` | Notification | `domain/notification/` | pending, sending, sent, failed, retrying | No |

### 8.12 FSM Design Rules

| Rule | Rationale |
|------|-----------|
| **States and events are typed constants**, not magic strings | Compile-time safety, IDE autocomplete, grep-able. |
| **Transition tables are the single source of truth** | No `if currentState == "charging"` scattered in code. |
| **Guards are pure functions** — no I/O, no side effects | Testable in isolation. I/O belongs in hooks. |
| **Hooks (OnEnter/OnExit/OnTransition) handle side effects** | Decouples the FSM from notifications, telemetry, etc. |
| **Every transition is persisted to `fsm_transitions`** | Auditability, debugging, replaying state history. |
| **Concurrent transitions are prevented via `SELECT ... FOR UPDATE`** | Avoids race conditions on the same entity. |
| **SubFSMs model detail within a parent state**, not independent processes | If a process is independent, it gets its own top-level FSM. |
| **SubFSMs auto-reset when the parent exits their owning state** | Prevents stale sub-state from leaking across entries. |
| **Terminal SubFSM states fire a parent event** | Enables automatic parent progression without manual wiring. |
| **FSM definitions live in the domain layer; hooks live in the app layer** | Domain stays pure. App layer wires in infrastructure concerns. |
| **New FSMs require an entry in the FSM Catalog (§8.11)** | Discoverability and documentation. |

### 8.13 Frontend FSM Visualization

**Rule: The frontend displays FSM state via a shared `StateBadge` component and state-specific colors.**

```typescript
// web/src/lib/fsm.ts — Shared FSM state display configuration

export type FSMStateConfig = {
  label: string;
  color: 'green' | 'yellow' | 'blue' | 'red' | 'gray';
  icon: string;
  pulse?: boolean;   // animated indicator for active states
};

export const vehicleStates: Record<string, FSMStateConfig> = {
  unknown:  { label: 'Unknown',  color: 'gray',   icon: 'help-circle' },
  online:   { label: 'Online',   color: 'green',  icon: 'wifi' },
  asleep:   { label: 'Asleep',   color: 'gray',   icon: 'moon' },
  driving:  { label: 'Driving',  color: 'blue',   icon: 'navigation', pulse: true },
  charging: { label: 'Charging', color: 'yellow', icon: 'zap',        pulse: true },
  offline:  { label: 'Offline',  color: 'red',    icon: 'wifi-off' },
};

export const chargingSubStates: Record<string, FSMStateConfig> = {
  'charging.starting':  { label: 'Starting',  color: 'yellow', icon: 'loader',   pulse: true },
  'charging.ramping':   { label: 'Ramping',   color: 'yellow', icon: 'trending-up', pulse: true },
  'charging.steady':    { label: 'Charging',  color: 'green',  icon: 'zap',      pulse: true },
  'charging.tapering':  { label: 'Tapering',  color: 'blue',   icon: 'trending-down' },
  'charging.complete':  { label: 'Complete',  color: 'green',  icon: 'check-circle' },
};
```

```tsx
// web/src/components/ui/StateBadge.tsx
import { type FSMStateConfig } from '@/lib/fsm';
import { cn } from '@/lib/utils';

interface StateBadgeProps {
  config: FSMStateConfig;
  subState?: FSMStateConfig;  // optional SubFSM state shown as secondary badge
  size?: 'sm' | 'md';
}

export function StateBadge({ config, subState, size = 'md' }: StateBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        colorClasses[config.color],
        config.pulse && 'animate-pulse'
      )}>
        <Icon name={config.icon} size={12} />
        {config.label}
      </span>
      {subState && (
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
          colorClasses[subState.color],
          subState.pulse && 'animate-pulse'
        )}>
          <Icon name={subState.icon} size={10} />
          {subState.label}
        </span>
      )}
    </div>
  );
}
```

### 8.14 Testing FSMs

**Rule: Every FSM definition must have full transition table coverage tests (all valid transitions + key invalid transitions).**

```go
// internal/domain/vehicle/fsm_test.go

func TestVehicleFSM_AllValidTransitions(t *testing.T) {
    engine := SetupVehicleFSM()

    tests := []struct {
        name  string
        from  fsm.State
        event fsm.Event
        want  fsm.State
    }{
        {"unknown → online", StateUnknown, EventComeOnline, StateOnline},
        {"online → driving", StateOnline, EventStartDrive, StateDriving},
        {"online → charging", StateOnline, EventPlugIn, StateCharging},
        {"online → asleep", StateOnline, EventSleep, StateAsleep},
        {"online → offline", StateOnline, EventGoOffline, StateOffline},
        {"driving → online", StateDriving, EventStopDrive, StateOnline},
        {"driving → charging", StateDriving, EventPlugIn, StateCharging},
        {"charging → online", StateCharging, EventUnplug, StateOnline},
        {"asleep → online", StateAsleep, EventWake, StateOnline},
        {"asleep → offline", StateAsleep, EventGoOffline, StateOffline},
        {"offline → online", StateOffline, EventComeOnline, StateOnline},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            v := &Vehicle{FSMState: tt.from}
            got, err := engine.Fire(context.Background(), v, tt.from, tt.event)
            require.NoError(t, err)
            assert.Equal(t, tt.want, got)
        })
    }
}

func TestVehicleFSM_InvalidTransitions(t *testing.T) {
    engine := SetupVehicleFSM()

    tests := []struct {
        name  string
        from  fsm.State
        event fsm.Event
    }{
        {"asleep cannot start driving", StateAsleep, EventStartDrive},
        {"offline cannot start driving", StateOffline, EventStartDrive},
        {"driving cannot sleep", StateDriving, EventSleep},
        {"unknown cannot sleep", StateUnknown, EventSleep},
        {"charging cannot start driving", StateCharging, EventStartDrive},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            v := &Vehicle{FSMState: tt.from}
            _, err := engine.Fire(context.Background(), v, tt.from, tt.event)
            assert.ErrorIs(t, err, fsm.ErrInvalidTransition)
        })
    }
}

// SubFSM tests
func TestChargingSubFSM_FullCycle(t *testing.T) {
    engine := SetupVehicleFSM() // includes SubFSM registration

    v := &Vehicle{FSMState: StateOnline}

    // Enter charging (activates SubFSM)
    state, err := engine.Fire(context.Background(), v, StateOnline, EventPlugIn)
    require.NoError(t, err)
    assert.Equal(t, StateCharging, state)

    // Walk through SubFSM states
    subState, err := engine.FireSub(context.Background(), v, StateCharging, charging.SubEventHandshakeOK)
    require.NoError(t, err)
    assert.Equal(t, charging.SubStateRamping, subState)

    subState, err = engine.FireSub(context.Background(), v, StateCharging, charging.SubEventRampComplete)
    require.NoError(t, err)
    assert.Equal(t, charging.SubStateSteady, subState)

    subState, err = engine.FireSub(context.Background(), v, StateCharging, charging.SubEventTaperStart)
    require.NoError(t, err)
    assert.Equal(t, charging.SubStateTapering, subState)

    // Terminal state triggers parent transition (Charging → Online via EventUnplug)
    subState, err = engine.FireSub(context.Background(), v, StateCharging, charging.SubEventTargetHit)
    require.NoError(t, err)
    assert.Equal(t, charging.SubStateComplete, subState)
    // Parent should have transitioned too
    assert.Equal(t, StateOnline, v.FSMState)
}
```

---

## 9. External API Integration

### 8.1 General Rules for External APIs

| Rule | Rationale |
|------|-----------|
| Every external call goes through a dedicated adapter in `internal/adapter/` | Single place to add retries, circuit breaking, metrics. |
| Every external call has a `context.Context` with timeout | Prevents one slow API from blocking the entire request. |
| Every adapter implements a port interface | Enables mocking in tests. |
| Responses are mapped to domain types in the adapter, not leaked upstream | Domain code doesn't know about Tesla's JSON shape. |
| Rate limits are respected and tracked via metrics | Tesla Fleet API has strict rate limits. |

### 8.2 Tesla Fleet API

```go
// internal/adapter/tesla/client.go
type Client struct {
    http       *http.Client
    baseURL    string
    oauth      *oauth2.Config
    rateLimiter *rate.Limiter
    metrics    *teslaMetrics
}

// Maps Tesla API response to domain type — adapter responsibility
func (c *Client) GetVehicleState(ctx context.Context, vin string) (*vehicle.State, error) {
    ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()

    if err := c.rateLimiter.Wait(ctx); err != nil {
        return nil, fmt.Errorf("rate limited: %w", err)
    }

    resp, err := c.doAuthenticatedRequest(ctx, "GET", fmt.Sprintf("/vehicles/%s/vehicle_data", vin))
    if err != nil {
        return nil, fmt.Errorf("tesla api: %w", err)
    }

    return mapTeslaResponseToState(resp), nil
}
```

### 8.3 Geocoding (Fallback Chain)

**Rule: Implement geocoding as a chain of providers with automatic fallback.**

```go
// internal/adapter/geocoding/chain.go
type Chain struct {
    providers []GeocodingProvider   // [GoogleMaps, AzureMaps, Nominatim]
    cache     cache.GeoCache        // Redis cache for resolved addresses
}

func (c *Chain) ReverseGeocode(ctx context.Context, lat, lon float64) (*Address, error) {
    // Check cache first (geo coordinates rounded to 4 decimal places for cache key)
    if cached, err := c.cache.Get(ctx, lat, lon); err == nil {
        return cached, nil
    }

    // Try each provider in order
    for _, p := range c.providers {
        addr, err := p.ReverseGeocode(ctx, lat, lon)
        if err == nil {
            c.cache.Set(ctx, lat, lon, addr, 24*time.Hour)
            return addr, nil
        }
        log.Warn().Err(err).Str("provider", p.Name()).Msg("geocoding fallback")
    }
    return nil, domain.ErrExternalAPI
}
```

---

## 10. Error Handling & Resilience

### 10.1 Retry Strategy

**Rule: Use exponential backoff with jitter for all retryable external calls.**

```go
// internal/platform/httputil/retry.go
type RetryConfig struct {
    MaxAttempts  int           // default: 3
    InitialDelay time.Duration // default: 100ms
    MaxDelay     time.Duration // default: 5s
    Multiplier   float64       // default: 2.0
    RetryableStatus []int      // [429, 500, 502, 503, 504]
}
```

### 10.2 Circuit Breaker

**Rule: Every external API adapter has a circuit breaker. State transitions are logged and emit metrics.**

| State | Behavior |
|-------|----------|
| **Closed** | Requests flow normally. Failures are counted. |
| **Open** | Requests fail immediately. Checked after timeout. |
| **Half-Open** | One probe request allowed. Success → Closed, Failure → Open. |

### 10.3 Graceful Degradation

| Component Down | Degraded Behavior |
|----------------|-------------------|
| Redis | Bypass cache, increase DB load. Log warning. |
| Tesla API | Serve stale data from cache/DB. Show "last updated" timestamp. |
| Geocoding | Return raw coordinates instead of address. |
| MongoDB | Skip raw telemetry storage. Continue processing. |
| MQTT | Buffer locally, reconnect with backoff. |

---

## 11. Testing Strategy

### 11.1 Test Pyramid

```
                    ┌──────────┐
                    │   E2E    │  ← Few, slow, high-confidence
                    │ (Cypress │     Smoke tests for critical paths
                    │  or PW)  │
                   ┌┴──────────┴┐
                   │ Integration │  ← Per-adapter, per-handler
                   │  (testcontainers, │  Real DB, real Redis, mocked externals
                   │   httptest)      │
                  ┌┴──────────────────┴┐
                  │     Unit Tests      │  ← Per-function, fast, isolated
                  │  (table-driven,     │     Domain logic, services with mocked ports
                  │   no I/O)           │
                  └─────────────────────┘
```

### 11.2 Go Test Rules

**Rule: Domain and application layer tests are pure unit tests — no database, no network, no filesystem.**

```go
// internal/app/vehiclesvc/service_test.go
func TestRefreshVehicle_Success(t *testing.T) {
    // Arrange — all dependencies are mocked interfaces
    mockRepo := &mocks.VehicleRepository{}
    mockTesla := &mocks.TeslaClient{}
    mockCache := &mocks.VehicleCache{}
    svc := vehiclesvc.New(mockRepo, mockCache, mockTesla)

    mockTesla.On("GetVehicleState", mock.Anything, "VIN123").
        Return(&vehicle.State{Battery: 80}, nil)
    mockRepo.On("Save", mock.Anything, mock.AnythingOfType("*vehicle.Vehicle")).
        Return(nil)

    // Act
    err := svc.Refresh(context.Background(), "vehicle-id-1")

    // Assert
    assert.NoError(t, err)
    mockRepo.AssertCalled(t, "Save", mock.Anything, mock.AnythingOfType("*vehicle.Vehicle"))
}
```

**Rule: Use table-driven tests for functions with multiple input/output scenarios.**

```go
func TestParseVIN(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    VIN
        wantErr bool
    }{
        {"valid Model 3", "5YJ3E1EA7KF123456", VIN{Model: "3", Year: 2019}, false},
        {"valid Model Y", "7SAYGDEE5PA123456", VIN{Model: "Y", Year: 2023}, false},
        {"too short", "5YJ3E1EA7KF", VIN{}, true},
        {"empty", "", VIN{}, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseVIN(tt.input)
            if tt.wantErr {
                assert.Error(t, err)
                return
            }
            assert.NoError(t, err)
            assert.Equal(t, tt.want, got)
        })
    }
}
```

**Rule: Integration tests use build tags and `testcontainers-go`.**

```go
//go:build integration

func TestVehicleRepository_Integration(t *testing.T) {
    ctx := context.Background()
    pgContainer := testutil.MustStartPostgres(ctx, t)
    pool := testutil.MustConnect(ctx, t, pgContainer)
    testutil.MustMigrate(pool)

    repo := postgres.NewVehicleRepository(pool)

    t.Run("save and retrieve", func(t *testing.T) {
        v := &vehicle.Vehicle{ID: "test-1", VIN: "5YJ3E1EA7KF123456"}
        err := repo.Save(ctx, v)
        require.NoError(t, err)

        got, err := repo.GetByID(ctx, "test-1")
        require.NoError(t, err)
        assert.Equal(t, v.VIN, got.VIN)
    })
}
```

### 11.3 Frontend Test Rules

**Rule: Every component has at least a smoke test. Interactive components have user-interaction tests.**

```tsx
// features/vehicles/components/VehicleCard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VehicleCard } from './VehicleCard';

describe('VehicleCard', () => {
  const vehicle = { id: '1', displayName: 'My Model 3', vin: '5YJ3E...', batteryLevel: 80 };

  it('renders vehicle name and battery', () => {
    render(<VehicleCard vehicle={vehicle} />);
    expect(screen.getByText('My Model 3')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', async () => {
    const onRefresh = vi.fn();
    render(<VehicleCard vehicle={vehicle} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledWith('1');
  });
});
```

**Rule: API hooks are tested with MSW (Mock Service Worker), not by mocking TanStack Query internals.**

### 11.4 Test Coverage Targets

| Layer | Target | Enforced? |
|-------|--------|-----------|
| Domain logic | ≥ 90% | Yes, CI blocks |
| Application services | ≥ 80% | Yes, CI blocks |
| Adapters (unit) | ≥ 70% | Yes, CI warns |
| Handlers | ≥ 70% | Yes, CI warns |
| React components | ≥ 70% | Yes, CI warns |
| React hooks | ≥ 80% | Yes, CI blocks |

---

## 12. Observability (Logging, Metrics, Tracing)

### 12.1 Structured Logging (Zerolog)

**Rule: All logs are structured JSON. No `fmt.Println` or `log.Println`.**

**Rule: Use consistent field names across the codebase.**

| Field | Type | Description |
|-------|------|-------------|
| `trace_id` | string | OpenTelemetry trace ID |
| `span_id` | string | OpenTelemetry span ID |
| `user_id` | string | Authenticated user |
| `vehicle_id` | string | Vehicle being operated on |
| `vin` | string | Vehicle VIN |
| `method` | string | HTTP method |
| `path` | string | HTTP path |
| `status` | int | HTTP status code |
| `duration_ms` | float64 | Request/operation duration |
| `err` | string | Error message (when applicable) |
| `component` | string | Package/module name |

```go
// GOOD — structured, consistent fields
log.Info().
    Str("component", "vehiclesvc").
    Str("vehicle_id", id).
    Str("trace_id", span.SpanContext().TraceID().String()).
    Float64("duration_ms", elapsed.Seconds()*1000).
    Msg("vehicle state refreshed")

// BAD — unstructured, inconsistent
log.Info().Msgf("refreshed vehicle %s in %v", id, elapsed)
```

### 12.2 Metrics (Prometheus)

**Rule: Every service exposes standard RED metrics (Rate, Errors, Duration).**

```go
// Naming: teslasync_{subsystem}_{metric}_{unit}
// Labels: kept to low cardinality (method, status_code, endpoint — NOT user_id, vin)

var (
    httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "teslasync_http_requests_total",
        Help: "Total HTTP requests",
    }, []string{"method", "endpoint", "status_code"})

    httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "teslasync_http_request_duration_seconds",
        Help:    "HTTP request duration in seconds",
        Buckets: prometheus.DefBuckets,
    }, []string{"method", "endpoint"})

    teslaAPICallsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "teslasync_tesla_api_calls_total",
        Help: "Total Tesla API calls",
    }, []string{"endpoint", "status"})
)
```

**Rule: Business metrics are tracked alongside system metrics.**

```go
// Examples of business metrics:
// teslasync_vehicles_synced_total
// teslasync_charging_sessions_completed_total
// teslasync_trips_recorded_total
// teslasync_telemetry_messages_processed_total
// teslasync_export_jobs_completed_total{format="csv|json"}
```

### 12.3 Distributed Tracing (OpenTelemetry)

**Rule: Every incoming HTTP request creates a span. Every outgoing call (DB, Redis, external API, MQTT publish) is a child span.**

```go
// Middleware adds the root span
// Adapters create child spans:
func (r *vehicleRepository) GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error) {
    ctx, span := otel.Tracer("postgres").Start(ctx, "VehicleRepository.GetByID",
        trace.WithAttributes(attribute.String("vehicle_id", id)))
    defer span.End()
    // ... query ...
}
```

### 12.4 SLI / SLO / Error Budgets

**Rule: Every user-facing service has defined SLIs, SLOs, and error budgets.**

| SLI (Indicator) | Measurement | SLO Target | Error Budget (30 days) |
|-----------------|-------------|------------|------------------------|
| **Availability** | `1 - (5xx responses / total responses)` | 99.9% | 43.2 minutes downtime |
| **Latency (API)** | p95 response time for non-streaming endpoints | < 200 ms | ≤ 5% of requests > 200 ms |
| **Latency (Dashboard)** | Time to Interactive (TTI) | < 2 s | ≤ 5% of page loads > 2 s |
| **Data freshness** | Age of latest vehicle state vs Tesla API | < 60 s | ≤ 5% of vehicles stale > 60 s |
| **Correctness** | Charging cost calculation accuracy | 99.95% | ≤ 0.05% miscalculations |

**Error budget policy:**
- When > 50% budget consumed: investigate, create action items.
- When > 80% budget consumed: freeze non-critical deploys, prioritize reliability.
- When 100% consumed: full feature freeze until budget recovers or root cause is fixed.

### 12.5 Alerting Standards

**Rule: Alerts are symptom-based, not cause-based. Alert on what users experience, not internal metrics.**

| Alert | Condition | Severity | Routing | Runbook |
|-------|-----------|----------|---------|---------|
| High error rate | 5xx rate > 1% for 5 min | Page (PagerDuty) | On-call engineer | `docs/runbooks/high-error-rate.md` |
| High latency | p95 > 500 ms for 5 min | Page | On-call engineer | `docs/runbooks/high-latency.md` |
| DB connection exhaustion | active connections > 80% of max | Page | On-call + DBA | `docs/runbooks/db-connections.md` |
| Tesla API degradation | error rate > 20% for 10 min | Ticket | Backend team | `docs/runbooks/tesla-api-degraded.md` |
| Certificate expiry | < 14 days to expiry | Ticket | Infra team | `docs/runbooks/cert-renewal.md` |
| Disk/memory pressure | > 85% utilization | Ticket | Infra team | `docs/runbooks/resource-pressure.md` |
| FSM stuck state | Entity in same state > 24h (unexpected) | Ticket | Backend team | `docs/runbooks/fsm-stuck.md` |

**Rules:**
- Every alert MUST have a linked runbook in `docs/runbooks/`.
- Runbook format: Symptoms → Impact → Investigation steps → Remediation → Escalation.
- Alerts must not fire more than once per incident (use grouping/inhibition).
- Alert fatigue review: quarterly audit of alert frequency and actionability.

### 12.6 Log Retention & Access

| Environment | Retention | Access |
|-------------|-----------|--------|
| Production | 90 days hot, 1 year cold (S3/GCS) | Engineering team; PII access requires approval |
| Staging | 30 days | Engineering team |
| Development | 7 days | All engineers |

**Rules:**
- Logs containing PII are tagged and subject to GDPR/privacy deletion requests.
- Log access is audited. No direct `kubectl logs` in production — use Grafana Loki / centralized logging.
- Sensitive fields (`Authorization`, `password`, `token`, `ssn`) are redacted at the logging middleware level.

### 12.7 Trace Sampling Strategy

| Environment | Sampling Rate | Notes |
|-------------|--------------|-------|
| Production | 10% head-based + 100% tail-based for errors/slow | Errors and latency > p95 always captured |
| Staging | 100% | Full visibility for testing |
| Development | 100% | Full visibility |

**Rule: Trace IDs are propagated in HTTP response headers (`X-Trace-ID`) for client-side correlation.**

### 12.8 Health Check Contract

| Endpoint | Purpose | Checks | Used By |
|----------|---------|--------|---------|
| `GET /healthz` | **Liveness** — is the process alive? | Process responsive, basic sanity | K8s liveness probe |
| `GET /readyz` | **Readiness** — can it accept traffic? | DB pool healthy, Redis reachable, JWKS loaded | K8s readiness probe |
| `GET /healthz/deep` | **Deep health** — is everything working? | All dependencies (DB, Redis, MQTT, Tesla API) + schema version check | Monitoring dashboard, pre-deploy checks |

```go
// readyz checks all critical dependencies
func readyzHandler(pool *pgxpool.Pool, redis *redis.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        checks := map[string]error{
            "postgres": pool.Ping(r.Context()),
            "redis":    redis.Ping(r.Context()).Err(),
        }
        allOK := true
        for _, err := range checks {
            if err != nil { allOK = false; break }
        }
        if !allOK {
            w.WriteHeader(http.StatusServiceUnavailable)
        }
        json.NewEncoder(w).Encode(checks)
    }
}
```

---

## 13. Security

### 13.1 Authentication & Authorization

| Layer | Mechanism |
|-------|-----------|
| Ingress | Traefik ForwardAuth → Authentik |
| API | JWT validation via JWKS endpoint. Middleware extracts claims. |
| Tesla OAuth | OAuth 2.0 tokens stored encrypted. Refresh tokens rotated. |
| mTLS | Fleet Telemetry connection requires mutual TLS. |

**Rule: Never log or expose tokens, secrets, or PII in logs/metrics/traces.**

```go
// Middleware extracts user from JWT and puts it in context
func AuthMiddleware(jwks *keyfunc.JWKS) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            token, err := extractAndValidateToken(r, jwks)
            if err != nil {
                respondError(w, http.StatusUnauthorized, "invalid token")
                return
            }
            ctx := context.WithValue(r.Context(), userContextKey, token.Claims)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

### 13.2 Secrets Management

| ✅ Do | ❌ Don't |
|-------|---------|
| Use environment variables or Kubernetes Secrets for credentials | Hardcode secrets in source code |
| Use SOPS for encrypting Helm values in Git | Commit plaintext `.env` files |
| Rotate Tesla OAuth refresh tokens periodically | Store tokens with no expiry |
| Encrypt sensitive DB columns (Tesla tokens) at rest | Store OAuth tokens in plaintext in PostgreSQL |

### 13.3 Input Validation & Sanitization

**Rule: Validate all external input at the boundary (HTTP handler, MQTT subscriber, CLI args).**

- SQL injection: Prevented by parameterized queries (pgx). Never concatenate user input into SQL.
- XSS: React escapes by default. Never use `dangerouslySetInnerHTML`.
- SSRF: Validate and allowlist URLs before making outbound requests from user input.
- Path traversal: Validate file paths in export worker. Use `filepath.Clean` and verify prefix.

### 13.4 OWASP Top 10 Control Matrix

| # | Risk | TeslaSync Control | Enforced By |
|---|------|-------------------|-------------|
| A01 | Broken Access Control | JWT + JWKS middleware on every endpoint; ownership checks in services | CI (auth middleware test), code review |
| A02 | Cryptographic Failures | TLS everywhere; AES-256 at-rest for OAuth tokens; bcrypt for password hashes | Infra config, CI (TLS probe) |
| A03 | Injection | Parameterized queries (pgx `$1` placeholders); no `dangerouslySetInnerHTML` | `golangci-lint` (`sqlclosecheck`, `noctx`), ESLint |
| A04 | Insecure Design | Threat model review for new features; FSM guards enforce business invariants | ADR process, code review |
| A05 | Security Misconfiguration | Distroless images; K8s SecurityContext (non-root, read-only fs); no debug endpoints in prod | Trivy scan, Helm lint, K8s OPA policies |
| A06 | Vulnerable Components | `govulncheck` + Trivy in CI; Dependabot/Renovate with SLA | CI blocks on critical/high CVEs |
| A07 | Auth Failures | Rate-limited login; JWT short expiry (15 min) + refresh token rotation | Auth middleware, Redis rate limiter |
| A08 | Data Integrity Failures | Cosign-signed container images; SBOM; pinned base images | CI release pipeline |
| A09 | Logging Failures | Structured logging with trace IDs; security events (auth failures, permission denials) logged at WARN | Code review, log audit |
| A10 | SSRF | URL allowlist for outbound requests; no user-controlled URLs to internal services | Code review, middleware |

### 13.5 Dependency Vulnerability SLA

| Severity | Detection → Fix SLA | Merge Blocking? |
|----------|---------------------|-----------------|
| Critical (CVSS ≥ 9.0) | 24 hours | Yes — CI blocks |
| High (CVSS 7.0–8.9) | 7 days | Yes — CI blocks |
| Medium (CVSS 4.0–6.9) | 30 days | No — CI warns |
| Low (CVSS < 4.0) | 90 days | No |

**Exception process:** If a fix is not available, file a security ADR documenting the risk, mitigation, and tracking issue. Review monthly.

### 13.6 Security Incident Response

| Phase | Actions | Owner |
|-------|---------|-------|
| **Detection** | Alert fires or report received. Classify: data breach, unauthorized access, vulnerability exploitation, supply chain. | On-call engineer |
| **Triage** (< 30 min) | Confirm incident. Assign severity (SEV1/SEV2/SEV3). Page incident commander. | Incident commander |
| **Containment** (< 2h for SEV1) | Isolate affected systems. Rotate compromised credentials. Block malicious actors. | Incident commander + affected team |
| **Eradication** | Patch vulnerability. Remove attacker artifacts. Verify no persistence. | Engineering team |
| **Recovery** | Restore service. Monitor for recurrence. | Engineering team + Infra |
| **Post-Incident** (within 5 days) | Blameless postmortem. Timeline. Root cause. Action items with owners and deadlines. | Incident commander |

### 13.7 Secret Rotation

| Secret Type | Rotation Cadence | Automation |
|-------------|-----------------|------------|
| Tesla OAuth refresh tokens | On use (sliding) + 90-day max | Application code |
| JWT signing keys (JWKS) | 90 days | Authentik auto-rotation |
| Database passwords | 90 days | Kubernetes Secret + rotation job |
| Redis password | 90 days | Kubernetes Secret |
| TLS certificates | Auto-renewed (Let's Encrypt, 60-day) | cert-manager |
| mTLS Fleet Telemetry certs | Annual | Manual with runbook |
| API keys (external services) | Annual | Manual with runbook |

**Emergency rotation:** If any secret is suspected compromised, rotate within 1 hour. Runbook: `docs/runbooks/emergency-secret-rotation.md`.

### 13.8 CORS Policy

```go
// internal/handler/middleware/cors.go
func CORSMiddleware() func(http.Handler) http.Handler {
    return cors.Handler(cors.Options{
        AllowedOrigins:   []string{"https://teslasync.yourdomain.com"},  // explicit, never "*"
        AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
        AllowedHeaders:   []string{"Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"},
        ExposedHeaders:   []string{"X-RateLimit-Remaining", "X-RateLimit-Reset", "X-Trace-ID"},
        AllowCredentials: true,
        MaxAge:           3600,
    })
}
```

**Rule: CORS `AllowedOrigins` MUST be explicit. Never use `*` (wildcard) in production.**

### 13.9 Security Headers

**Rule: All responses include these headers. Enforced via middleware.**

```go
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Header().Set("X-Frame-Options", "DENY")
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
        w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        w.Header().Set("X-XSS-Protection", "0")  // disabled in favor of CSP
        w.Header().Set("Content-Security-Policy",
            "default-src 'self'; "+
            "script-src 'self'; "+
            "style-src 'self' 'unsafe-inline'; "+  // Tailwind requires unsafe-inline for now
            "img-src 'self' data: https://*.tile.openstreetmap.org; "+
            "connect-src 'self'; "+
            "font-src 'self'; "+
            "frame-ancestors 'none'; "+
            "base-uri 'self'; "+
            "form-action 'self'")
        next.ServeHTTP(w, r)
    })
}
```

### 13.10 Data Classification

| Classification | Examples | Storage | Encryption | Logging | Retention |
|----------------|----------|---------|------------|---------|-----------|
| **Public** | Vehicle model, general statistics | Standard | At rest (disk) | Allowed | Indefinite |
| **Internal** | Trip data, charging history, efficiency metrics | Standard | At rest | Allowed (no PII) | Per user request |
| **Confidential** | User email, VIN, location data | Access-controlled | At rest + in transit | Redacted | GDPR: delete on request |
| **Secret** | OAuth tokens, API keys, passwords | Encrypted column or K8s Secret | AES-256 at rest + TLS in transit | NEVER logged | Rotate per §13.7 |

---

## 14. Infrastructure & Deployment

### 14.1 Docker Images

**Rule: Multi-stage builds. Distroless runtime images. No build tools in production.**

```dockerfile
# Dockerfile.api
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /teslasync ./cmd/teslasync

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /teslasync /teslasync
EXPOSE 8080
ENTRYPOINT ["/teslasync"]
```

### 14.2 Kubernetes & Helm

**Rule: All manifests are templated via Helm. No raw YAML applied to clusters.**

**Health checks:**

```yaml
# Every container MUST define all three probes
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /readyz          # Checks DB + Redis connectivity
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5

startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30     # 30 × 2s = 60s max startup time
  periodSeconds: 2
```

**Resource management:**

```yaml
resources:
  requests:
    cpu: 100m              # Minimum — affects scheduling
    memory: 128Mi
  limits:
    cpu: 500m              # Hard ceiling
    memory: 512Mi
```

### 14.3 Graceful Shutdown

**Rule: Every service handles SIGTERM gracefully.**

```go
func gracefulShutdown(ctx context.Context, server *http.Server, timeout time.Duration) {
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    log.Info().Msg("shutting down server")
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    // 1. Stop accepting new requests
    server.Shutdown(ctx)
    // 2. Drain in-flight requests (handled by Shutdown)
    // 3. Close DB pool, Redis, MQTT connections
    // 4. Flush telemetry
}
```

### 14.4 Disaster Recovery & Backup

| Component | RPO (Recovery Point) | RTO (Recovery Time) | Backup Method | Frequency | Verification |
|-----------|----------------------|---------------------|---------------|-----------|--------------|
| PostgreSQL | 1 hour | 4 hours | WAL archiving + daily `pg_basebackup` | Continuous WAL + daily full | Monthly restore drill |
| Redis | N/A (cache, rebuilt from source) | 5 minutes (restart) | No backup (cache-aside pattern) | — | — |
| MongoDB | 24 hours | 4 hours | `mongodump` to S3 | Daily | Quarterly restore drill |
| Helm values / config | 0 (Git is source of truth) | 30 minutes (redeploy) | Git | Every commit | Every deploy |
| Kubernetes secrets | 0 (SOPS-encrypted in Git) | 30 minutes | Git + SOPS | Every commit | Every deploy |

**DR drill schedule:** Semi-annual full DR exercise. Quarterly partial (database restore). Results documented in `docs/adr/`.

**Backup rules:**
- All backups are encrypted at rest (AES-256) and in transit (TLS).
- Backups are stored in a different availability zone / region than the primary.
- Backup retention: 30 days for daily, 12 months for monthly snapshots.
- Restore is tested every quarter — untested backups are not backups.

### 14.5 Network Policies

**Rule: Default-deny ingress and egress. Explicitly allow only required traffic.**

```yaml
# Default deny all ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]

---
# Allow teslasync API to reach Postgres, Redis, MQTT
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: teslasync-api-egress
spec:
  podSelector:
    matchLabels:
      app: teslasync
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector: { matchLabels: { app: postgresql } }
      ports: [{ port: 5432 }]
    - to:
        - podSelector: { matchLabels: { app: redis } }
      ports: [{ port: 6379 }]
    - to:
        - podSelector: { matchLabels: { app: mosquitto } }
      ports: [{ port: 1883 }, { port: 8883 }]
    - to: # Tesla API (external)
        - ipBlock: { cidr: 0.0.0.0/0 }
      ports: [{ port: 443 }]
    - to: # DNS
      ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]
```

### 14.6 Pod Disruption Budgets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: teslasync-api-pdb
spec:
  minAvailable: 1          # At least 1 pod always running during disruptions
  selector:
    matchLabels:
      app: teslasync
```

**Rule: Every Deployment with > 1 replica MUST have a PDB.**

### 14.7 Namespace & Resource Strategy

| Namespace | Contents | ResourceQuota |
|-----------|----------|---------------|
| `teslasync-prod` | API, workers, Mosquitto | CPU: 8 cores, Memory: 16 Gi |
| `teslasync-staging` | Full stack mirror | CPU: 4 cores, Memory: 8 Gi |
| `teslasync-data` | PostgreSQL, Redis, MongoDB | CPU: 8 cores, Memory: 32 Gi |
| `teslasync-monitoring` | Prometheus, Grafana, Jaeger | CPU: 4 cores, Memory: 8 Gi |

### 14.8 GitOps Workflow

**Rule: All deployments are declarative and Git-driven. No `kubectl apply` or `helm install` from local machines.**

```
Developer pushes code → CI builds + tests + pushes image to GHCR
  ↓
CI updates Helm values (image tag) → commits to deploy branch
  ↓
ArgoCD / Flux detects change → syncs to cluster
  ↓
Rolling update with readiness gates → Prometheus health check
  ↓
If health check fails → automatic rollback to previous revision
```

**Rules:**
- Production deploys require PR approval on the deploy branch.
- Drift detection: ArgoCD alerts if cluster state differs from Git.
- Emergency hotfix: allowed via direct Helm upgrade, but MUST be back-ported to Git within 1 hour.

---

## 15. CI/CD & Code Quality Gates

### 15.1 CI Pipeline (GitHub Actions)

```
PR Opened / Updated
  ├── Go Lint (golangci-lint)
  ├── Go Unit Tests (go test -short ./...)
  ├── Go Integration Tests (testcontainers, -tags=integration)
  ├── Go Build (all three binaries)
  ├── Frontend Lint (ESLint + tsc --noEmit)
  ├── Frontend Unit Tests (vitest)
  ├── Frontend Build (vite build)
  ├── Helm Lint (helm lint)
  ├── Security: govulncheck
  ├── Security: Trivy (container image scan)
  └── Security: CodeQL (static analysis)
```

**Rule: All checks must pass before merge. No "skip CI" commits to main.**

### 15.2 golangci-lint Configuration

```yaml
# .golangci.yml — required linters
linters:
  enable:
    # Correctness
    - errcheck          # Unchecked errors
    - govet             # Suspicious constructs
    - staticcheck       # Advanced static analysis
    - unused            # Unused code
    - gosimple          # Simplification opportunities
    - ineffassign       # Ineffectual assignments
    - gocritic          # Opinionated checks
    - revive            # Comprehensive linter
    - exhaustive        # Exhaustive enum/const switch checks (critical for FSM states)
    - contextcheck      # Missing context propagation
    - noctx             # HTTP requests without context
    - sqlclosecheck     # Unclosed SQL rows
    - bodyclose         # Unclosed HTTP response bodies
    - exportloopref     # Loop variable capture bugs
    # Security
    - gosec             # Security-oriented checks (SQL injection, hardcoded creds, etc.)
    - depguard          # Dependency allowlist/blocklist enforcement
    # Quality
    - misspell          # Spelling mistakes in comments
    - dupl              # Duplicate code detection (threshold: 100 tokens)
    - gocyclo           # Cyclomatic complexity (max: 15)
    - funlen            # Function length (max: 80 lines)
    - nestif            # Deeply nested if blocks (max: 4)
    - prealloc          # Slice preallocation hints
    - unconvert         # Unnecessary type conversions
    - unparam           # Unused function parameters
    - wastedassign      # Wasted assignments

linters-settings:
  dupl:
    threshold: 100
  gocyclo:
    min-complexity: 15
  funlen:
    lines: 80
    statements: 50
  exhaustive:
    default-signifies-exhaustive: true  # switch with default is considered exhaustive
  nestif:
    min-complexity: 4
  depguard:
    rules:
      main:
        deny:
          - pkg: "io/ioutil"
            desc: "Deprecated: use io and os packages"
          - pkg: "github.com/pkg/errors"
            desc: "Use fmt.Errorf with %w instead"
        files:
          - "!**/internal/adapter/**"  # Only adapters may import driver packages
```

### 15.3 ESLint Configuration

```js
// Key rules for preventing duplication and inconsistency
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["axios"], "message": "Use the shared apiClient from @/api/client" },
        { "group": ["../../../*"], "message": "Use path aliases (@/) instead of deep relative imports" }
      ]
    }],
    "react/no-unstable-nested-components": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "import/no-duplicates": "error",
    "import/no-cycle": "error"
  }
}
```

### 15.4 Branch Protection & Merge Rules

| Rule | Setting |
|------|---------|
| Required reviewers | ≥ 1 approval (≥ 2 for `internal/domain/`, `migrations/`, `deploy/`, `.github/`) |
| Required status checks | All CI jobs must pass (lint, test, build, security) |
| Stale review dismissal | ON — approval is dismissed when new commits are pushed |
| Admin bypass | OFF in production branches |
| Merge strategy | Squash merge to `main` (clean history) |
| Branch naming | `feat/`, `fix/`, `refactor/`, `chore/`, `hotfix/` prefixes |
| Auto-delete branches | ON after merge |
| Signed commits | Recommended (required for release branches) |

### 15.5 Release Strategy

**Versioning:** Semantic Versioning 2.0 (`MAJOR.MINOR.PATCH`).

| Release Type | Trigger | Process |
|--------------|---------|---------|
| **Patch** (x.x.X) | Bug fix, security patch | Merge to `main` → auto-tag → auto-release |
| **Minor** (x.X.0) | New feature, non-breaking API change | Merge to `main` → manual tag → release with changelog |
| **Major** (X.0.0) | Breaking API change, major architecture change | ADR approval → feature branch → staged rollout → tag |
| **Hotfix** | Critical production issue | Branch from latest release tag → fix → merge to `main` + cherry-pick |

**Changelog:** Auto-generated from conventional commit messages. Published in GitHub Releases and `CHANGELOG.md`.

### 15.6 Progressive Delivery

```
Code merged to main
  │
  ├─ CI builds + signs image
  ├─ Deploys to staging (automatic)
  ├─ Staging smoke tests (automatic)
  │
  ├─ Canary deploy: 10% of prod traffic (manual trigger)
  │   ├─ Monitor error rate, latency, business metrics for 15 min
  │   ├─ If healthy → promote to 50% → monitor 15 min → promote to 100%
  │   └─ If unhealthy → automatic rollback to previous version
  │
  └─ Full production deploy
      └─ Post-deploy health check (deep /healthz)
```

**Rollback procedure:**
1. ArgoCD: revert to previous Git commit on deploy branch
2. Helm: `helm rollback teslasync <previous-revision>`
3. If schema migration involved: follow the expand-contract rollback steps (§5.7)
4. Post-rollback: page incident commander, create postmortem

### 15.7 Feature Flags

| Rule | Details |
|------|---------|
| Storage | Configuration file or environment variable (not database for latency reasons) |
| Naming | `FEATURE_{FEATURE_NAME}_ENABLED` (env) or `features.{featureName}.enabled` (config) |
| Ownership | Every flag has an owner in the codebase (comment or CODEOWNERS) |
| Cleanup deadline | Flags must be removed within 30 days of full rollout. Tracked as tech-debt issues. |
| Kill switch | Every feature flag supports immediate disable without deploy |
| Audit | Flag state changes are logged at INFO level |

```go
// internal/platform/config/features.go
type FeatureFlags struct {
    AdvancedAnalytics bool `env:"FEATURE_ADVANCED_ANALYTICS_ENABLED" envDefault:"false"`
    ExportV2          bool `env:"FEATURE_EXPORT_V2_ENABLED" envDefault:"false"`
    SubFSMCharging    bool `env:"FEATURE_SUBFSM_CHARGING_ENABLED" envDefault:"true"`
}
```

### 15.8 Supply Chain Security

| Practice | Tool | CI Stage |
|----------|------|----------|
| Container image signing | `cosign` | Release pipeline |
| Signature verification on deploy | `cosign verify` | ArgoCD admission controller |
| SBOM generation | `syft` (SPDX format) | Release pipeline |
| SBOM attestation | `cosign attest` | Release pipeline |
| Vulnerability scanning (image) | Trivy | CI + nightly cron |
| Vulnerability scanning (code) | `govulncheck` + CodeQL | CI on every PR |
| Dependency review | GitHub Dependency Review action | CI on every PR |
| License compliance | `go-licenses` + `license-checker` (npm) | CI on every PR |
| Base image pinning | Digest-pinned images in Dockerfiles | Code review |

---

## 16. Refactoring Playbook

This section provides step-by-step procedures for common refactoring tasks during the cleanup effort.

### 16.1 Before You Refactor: The Checklist

- [ ] **Identify the smell:** Name the specific problem (duplicate code, god function, leaking abstraction, etc.)
- [ ] **Write a characterization test:** Before changing anything, write a test that captures the current behavior — even if the behavior is buggy, you need to know what changes.
- [ ] **Check the blast radius:** Which other packages/components import or depend on the code you're changing?
- [ ] **Plan the PR sequence:** If the refactor touches > 400 lines, plan how to split it into incremental PRs.
- [ ] **Communicate:** Post a brief RFC in the PR description or team channel if the change affects shared interfaces.

### 16.2 Extracting Duplicate Code

**Step 1: Find all instances.** Use `grep -rn` or IDE "Find Usages" to locate every copy.

**Step 2: Identify the canonical version.** Which copy is most complete / correct / tested?

**Step 3: Extract to the right layer:**

| Duplicate Is | Extract To |
|-------------|-----------|
| Business logic | `internal/domain/{aggregate}/` |
| Use-case orchestration | `internal/app/{service}/` |
| Database query pattern | `internal/adapter/postgres/` |
| HTTP helper (request parsing, response writing) | `internal/handler/middleware/` or `internal/platform/httputil/` |
| React component | `components/ui/` or `components/feedback/` |
| React data fetching | `api/hooks/` |
| TypeScript utility | `lib/` |

**Step 4: Replace all call sites.** Import the extracted function/component. Delete the old copies.

**Step 5: Run tests.** All existing tests must pass. Add tests for the extracted code if none existed.

### 16.3 Breaking Up God Functions

**Symptom:** A function that is > 80 lines, has cyclomatic complexity > 15, or mixes multiple concerns.

**Procedure:**

1. **Outline:** Read the function and write comments marking logical sections.
2. **Extract methods:** Each section becomes a private method with a descriptive name.
3. **Test each method:** Write unit tests for extracted methods.
4. **Simplify the parent:** The original function becomes a coordinator that calls the extracted methods.

```go
// BEFORE — 150-line function mixing validation, DB, API, and notification logic
func (s *Service) ProcessChargingSession(ctx context.Context, raw RawSession) error {
    // 30 lines of validation...
    // 40 lines of DB operations...
    // 30 lines of Tesla API calls...
    // 25 lines of cost calculation...
    // 25 lines of notification logic...
}

// AFTER — coordinator function, each step is testable
func (s *Service) ProcessChargingSession(ctx context.Context, raw RawSession) error {
    session, err := s.validateAndParse(raw)
    if err != nil {
        return fmt.Errorf("validate: %w", err)
    }
    if err := s.enrichWithTeslaData(ctx, session); err != nil {
        return fmt.Errorf("enrich: %w", err)
    }
    if err := s.calculateCost(ctx, session); err != nil {
        return fmt.Errorf("calculate cost: %w", err)
    }
    if err := s.repo.Save(ctx, session); err != nil {
        return fmt.Errorf("save: %w", err)
    }
    s.notifyAsync(ctx, session) // fire-and-forget, errors logged internally
    return nil
}
```

### 16.4 Migrating Scattered SQL to Repository Pattern

**Current state (bad):** SQL queries embedded in handlers, services, and random utility functions.

**Target state:** All SQL lives in `internal/adapter/postgres/`, behind port interfaces.

**Procedure:**

1. **Audit:** Run `grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/` to find all SQL.
2. **Group by entity:** Cluster queries by the table/aggregate they operate on.
3. **Create repository interface:** Define the port in `internal/port/repository/`.
4. **Create implementation:** Move queries to `internal/adapter/postgres/queries/` constants, implement the repository.
5. **Update callers:** Services now depend on the repository interface instead of `*pgxpool.Pool`.
6. **Remove direct pool access:** Services should not have access to the raw pool (except for transaction management).

### 16.5 Consolidating Frontend API Calls

**Current state (bad):** `fetch()` calls scattered across components, inconsistent error handling, no caching strategy.

**Target state:** All API calls go through TanStack Query hooks in `api/hooks/`.

**Procedure:**

1. **Audit:** `grep -rn "fetch(\|axios\|apiClient" web/src/` to find all API calls.
2. **Group by resource:** `/vehicles`, `/trips`, `/charging`, etc.
3. **Create query key factory:** Centralized key definitions prevent cache key conflicts.
4. **Create hooks:** One file per resource in `api/hooks/`.
5. **Replace all direct calls:** Components use hooks, never `fetch()` directly.
6. **Add MSW handlers:** For each endpoint, create a mock in `test/mocks/handlers/`.

### 16.6 De-duplicating React Components

**Procedure:**

1. **Inventory:** List all components across `features/*/components/` and `components/`.
2. **Identify overlaps:** Find components with similar purpose (e.g., multiple loading spinners, card layouts, data tables).
3. **Choose the best version:** Pick the most complete/accessible implementation.
4. **Generalize:** Add props to handle the differences between the copies.
5. **Promote to `components/`:** Move the canonical version to `components/ui/` or `components/feedback/`.
6. **Replace & delete:** Update all import paths. Delete the old copies.
7. **Add Storybook stories (optional):** Document the shared component visually.

### 16.7 Migrating Ad-Hoc State Logic to FSM Engine

**Current state (bad):** State transitions implemented via `if/else` and `switch` chains in handlers,
services, and workers. Guard conditions duplicated. No audit trail. Race conditions on concurrent events.

**Target state:** All state transitions go through the FSM engine with declarative transition tables,
guards, hooks, and persisted history.

**Procedure:**

1. **Inventory:** Search for state-related logic: `grep -rn "state\|status\|fsm\|transition" internal/`.
   List every place where an entity's state is changed.
2. **Map the state machine:** Draw the states and transitions for each entity on paper or a diagram.
   Identify which transitions have guards (preconditions) and which have side effects.
3. **Define the FSM in domain layer:** Create `internal/domain/{entity}/fsm.go` with typed state/event
   constants and a declarative `NewXxxFSM()` function.
4. **Identify SubFSM candidates:** If any state has its own internal lifecycle (sub-states, sub-transitions),
   extract it as a SubFSM in `internal/domain/{entity}/sub_fsm.go`.
5. **Extract guards:** Move precondition checks into named guard functions in `internal/domain/{entity}/guards.go`.
6. **Extract hooks:** Move side effects (notifications, telemetry, calculations) into named hook functions
   in `internal/app/{service}/hooks.go`.
7. **Wire in application service:** Create a `HandleXxxEvent()` method that: loads entity with row lock →
   fires FSM event → persists new state → records transition history — all in one TX.
8. **Replace all call sites:** Every `entity.State = "new_state"` becomes `fsmEngine.Fire(ctx, entity, event)`.
9. **Add DB columns:** Add `fsm_state` (and `sub_fsm_state` if SubFSM) columns via migration.
   Backfill existing rows with the correct state values.
10. **Add to FSM Catalog:** Update §8.11 with the new FSM entry.
11. **Write tests:** Cover all valid transitions, key invalid transitions, guard rejections, and SubFSM lifecycle.

---

## 17. Anti-Patterns Catalog

This catalog documents specific patterns found in the current codebase that must be eliminated during refactoring. Reference these by name in PR reviews.

### 17.1 Backend Anti-Patterns

| ID | Anti-Pattern | Problem | Fix |
|----|-------------|---------|-----|
| B1 | **Scattered SQL** | SQL queries in handlers, services, utils — impossible to audit, easy to duplicate | Move all SQL to `adapter/postgres/`. Expose via repository interface. |
| B2 | **God Function** | Functions > 100 lines doing validation + DB + API + notifications | Extract into focused, testable functions. One function = one job. |
| B3 | **Swallowed Errors** | `if err != nil { log.Error() }` with no return — caller thinks success | Always return errors. Let the caller decide what to do. |
| B4 | **Global State** | Package-level `var db *pgxpool.Pool` accessed directly | Inject via constructor. No global mutable state. |
| B5 | **Missing Context** | Functions that do I/O without `context.Context` | Add `ctx context.Context` as first parameter. |
| B6 | **Stringly-Typed** | Magic strings like `"charging"`, `"idle"`, `"driving"` scattered everywhere | Define `type VehicleState string` constants in domain package. |
| B7 | **Config Scatter** | `os.Getenv("DB_HOST")` in random packages | Single `config.MustLoad()` at startup. Pass config down. |
| B8 | **Copy-Paste Handlers** | HTTP handlers that duplicate JSON parsing, validation, error response logic | Extract shared `DecodeAndValidate`, `Respond`, `RespondError` helpers. |
| B9 | **Bare Goroutines** | `go func() { ... }()` without error handling or panic recovery | Use `errgroup.Group` or wrap with panic recovery. |
| B10 | **No Timeouts** | External API calls with no context timeout | Wrap every outbound call with `context.WithTimeout`. |
| B11 | **Ad-Hoc State Machines** | State transitions via `if/else`/`switch` chains scattered in handlers and services | Use the FSM engine (`internal/domain/fsm/`). Define transitions declaratively. |
| B12 | **Implicit State Transitions** | State changes happen as side effects in unrelated functions, not clearly named transition logic | Route ALL state changes through `fsmEngine.Fire()`. Wrap in a transaction. |
| B13 | **Missing FSM Guards** | Invalid transitions silently succeed, producing corrupt data (e.g., charging session completed with 0 kWh) | Add guards to the FSM definition. Guards enforce preconditions before transitions. |
| B14 | **SubFSM State Leak** | SubFSM state persists after the parent exits the owning state, causing stale sub-state on re-entry | Configure `ResetOnExit: true` on SubFSM registration. |
| B15 | **Unaudited Transitions** | No record of how an entity reached its current state — impossible to debug | Persist every transition to `fsm_transitions` table inside the same TX. |

### 17.2 Frontend Anti-Patterns

| ID | Anti-Pattern | Problem | Fix |
|----|-------------|---------|-----|
| F1 | **Direct fetch()** | `fetch('/api/...')` in components — no caching, no error handling, no auth | Use TanStack Query hooks via `api/hooks/`. |
| F2 | **Prop Drilling** | Passing data through 5+ component levels | Use TanStack Query (server state) or React Context (client state). |
| F3 | **useEffect for Data** | `useEffect(() => { fetch(...).then(setData) }, [])` | Use `useQuery` — handles loading, error, caching, refetch. |
| F4 | **Duplicated Components** | Multiple loading spinners, error displays, card layouts | Consolidate into `components/ui/` and `components/feedback/`. |
| F5 | **any Types** | `data: any` — disables TypeScript's entire value proposition | Use proper types. `unknown` + narrowing when type is uncertain. |
| F6 | **Hardcoded Strings** | User-facing text in JSX without i18next | Use `useTranslation()` and translation keys. |
| F7 | **Inline Styles** | `style={{ marginTop: 16, color: '#333' }}` | Use Tailwind utility classes. |
| F8 | **Index as Key** | `{items.map((item, i) => <Item key={i} />)}` with dynamic lists | Use stable unique IDs as keys. |
| F9 | **Giant Components** | Single component file > 200 lines | Extract sub-components and custom hooks. |
| F10 | **State Duplication** | `useState` mirroring server data already in TanStack Query cache | Remove local state, use query data directly. |
| F11 | **Raw HTML in Features** | Feature component creates `<button>`, `<input>`, `<table>` with raw Tailwind instead of using shared components | Use `Button`, `Input`, `DataTable` from `components/`. Code review rejection. |
| F12 | **Shadow Components** | Creating a new `LoadingCard` / `MetricBox` / `ChartWrapper` in a feature that duplicates a shared component | Search `components/` first. Extend existing component with a prop if needed. |
| F13 | **Missing Barrel Export** | New shared component exists in `components/ui/` but not exported from `components/ui/index.ts` | Every shared component must be in its barrel `index.ts`. |
| F14 | **Raw Recharts/Leaflet/Framer** | Feature code imports `recharts`, `leaflet`, or `framer-motion` directly instead of using wrappers | Use `components/charts/`, `components/maps/`, `components/motion/` wrappers. |
| F15 | **No a11y on Interactive Elements** | `IconButton` without `label`, `Modal` without focus trap, form input without `aria-describedby` on error | Follow §4.6 a11y rules. Every interactive shared component has a11y built in. |

---

## 18. Code Review Checklist

Every PR must be reviewed against this checklist before approval.

### 18.1 Structural Integrity

- [ ] Does the change respect the dependency direction? (`cmd → handler → app → domain ← port ← adapter`)
- [ ] Is new code placed in the correct layer/package?
- [ ] Are interfaces defined in `internal/port/`, not next to implementations?
- [ ] Does the PR introduce any circular imports?
- [ ] For new external dependencies: is there a port interface + adapter, or is the dependency leaked into business logic?

### 18.2 Duplication Check

- [ ] Is there existing code that does the same thing? (Search before writing)
- [ ] If extracting shared code, is it placed at the correct level of abstraction?
- [ ] Are query keys, API endpoints, or error messages defined once and imported?
- [ ] Does the PR reduce the overall duplication count, or add to it?

### 18.3 Error Handling

- [ ] Are all errors either returned or explicitly logged with justification?
- [ ] Do errors include context (`fmt.Errorf("doing X: %w", err)`)?
- [ ] Are domain errors used (not raw HTTP status codes in service layer)?
- [ ] Is the error response to the client consistent with the envelope format?

### 18.4 Testing

- [ ] Are there tests for the new/changed behavior?
- [ ] Do tests cover both happy path and error cases?
- [ ] Are tests deterministic (no time-dependent, no random without seed)?
- [ ] Do integration tests use testcontainers/MSW, not live services?
- [ ] Are mocks based on interfaces from `internal/port/`?

### 18.5 Observability

- [ ] Do new code paths have structured log statements?
- [ ] Are log levels appropriate? (`Error` for failures, `Warn` for degradation, `Info` for business events, `Debug` for development)
- [ ] Do new external calls emit metrics and tracing spans?
- [ ] Are sensitive fields excluded from logs? (No tokens, passwords, PII)

### 18.6 Security

- [ ] Are new endpoints protected by auth middleware?
- [ ] Is user input validated at the handler boundary?
- [ ] Are SQL queries parameterized (no string concatenation)?
- [ ] Are secrets injected via environment, not hardcoded?

### 18.7 FSM & SubFSM

- [ ] Are state transitions routed through the FSM engine (`fsmEngine.Fire()`) — not ad-hoc `if/switch`?
- [ ] Is the transition table in the domain layer (`internal/domain/{entity}/fsm.go`) the single source of truth?
- [ ] Are guards defined for transitions that have preconditions?
- [ ] Are side effects in hooks (OnEnter/OnExit/OnTransition), not inlined in the `Fire` call?
- [ ] Is the transition persisted to `fsm_transitions` inside the same DB transaction as the state update?
- [ ] Is `SELECT ... FOR UPDATE` used to prevent concurrent transitions on the same entity?
- [ ] If a SubFSM is involved: is `ResetOnExit: true` configured? Are terminal states mapped to a parent event?
- [ ] Is the new FSM / SubFSM added to the FSM Catalog (§8.11)?
- [ ] Do tests cover all valid transitions AND key invalid transitions?

---

## 19. Decision Log

Record significant architectural decisions here using the ADR format. Full ADRs live in `docs/adr/`.

| # | Date | Decision | Status |
|---|------|----------|--------|
| 1 | — | Use hexagonal architecture (ports & adapters) for backend | Accepted |
| 2 | — | TanStack Query as the single data-fetching layer for frontend | Accepted |
| 3 | — | PostgreSQL as primary store; Redis as cache-only; MongoDB for raw telemetry only | Accepted |
| 4 | — | Cursor-based pagination over offset-based | Accepted |
| 5 | — | UUIDv7 for all primary keys (time-sortable, no DB sequence bottleneck) | Accepted |
| 6 | — | Feature-based frontend organization over type-based | Accepted |
| 7 | — | MQTT signal batching (5s windows) to reduce DB write amplification | Accepted |
| 8 | — | Geocoding fallback chain: Google → Azure → Nominatim | Accepted |
| 9 | — | Circuit breakers on all external API adapters | Accepted |
| 10 | — | golangci-lint `dupl` linter with 100-token threshold to catch copy-paste | Accepted |
| 11 | — | Unified FSM engine in `internal/domain/fsm/` for all state machines — declarative transition tables, guards, hooks | Accepted |
| 12 | — | SubFSMs for nested state behavior (e.g., charging phases within vehicle charging state) | Accepted |
| 13 | — | All FSM transitions audited to `fsm_transitions` table with trace IDs | Accepted |
| 14 | — | Concurrent FSM transitions prevented via `SELECT ... FOR UPDATE` row locks | Accepted |

---

## 20. AI Agent (Copilot) Strict Operating Rules

> **This section is mandatory for all AI coding agents (GitHub Copilot CLI, Copilot Cloud Agent,
> or any LLM-based assistant) that generate, modify, or review code in this repository.**
>
> **These are not suggestions. They are hard rules. Violations result in reverted PRs.**

### 20.1 Prime Directive

**You are not here to produce code quickly. You are here to produce code that is correct,
consistent with these guidelines, and maintainable by the team. Speed is irrelevant if the
output creates technical debt.**

Before writing a single line of code, you MUST:
1. Read and internalize the relevant sections of this document.
2. Understand the existing codebase patterns by searching before creating.
3. Follow the established architecture — never invent new patterns without explicit approval.

### 20.2 Pre-Flight Checklist — Before Writing ANY Code

Every time you receive a task that involves creating or modifying code, execute this checklist
**in order, without skipping any step.** This is not optional.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MANDATORY PRE-FLIGHT CHECKLIST                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  □ 1. UNDERSTAND THE REQUEST                                       │
│     - What exactly is being asked?                                 │
│     - What domain aggregate does this touch?                       │
│     - Which layers are affected (domain, app, adapter, handler)?   │
│                                                                     │
│  □ 2. SEARCH THE CODEBASE FIRST                                   │
│     - Does similar code already exist?                             │
│     - Is there an existing component/function/hook I should reuse? │
│     - Is there an established pattern for this type of change?     │
│     - Search: grep/glob for related types, functions, components.  │
│     - NEVER assume — always verify by searching.                   │
│                                                                     │
│  □ 3. IDENTIFY THE CORRECT LOCATION                               │
│     - Consult Appendix A ("Where Does This Code Go?")              │
│     - Consult §2.1 (Monorepo Layout) for the exact directory      │
│     - Verify the dependency direction (§2.2)                       │
│     - If unsure, ASK — do not guess and create in a wrong folder   │
│                                                                     │
│  □ 4. CHECK FOR REUSABLE COMPONENTS                               │
│     - FRONTEND: Search ALL of components/ (ui, layout, feedback,   │
│       data-display, charts, maps, forms, motion) — §4.2 catalog    │
│     - FRONTEND: Search hooks/ for existing custom hooks — §4.4     │
│     - BACKEND: Search internal/domain/ for existing types          │
│     - BACKEND: Search internal/port/ for existing interfaces       │
│     - BACKEND: Search internal/platform/ for existing utilities    │
│     - BACKEND: Search internal/adapter/postgres/queries/ for SQL   │
│     - If something similar exists, USE IT. Do not recreate.        │
│                                                                     │
│  □ 5. VERIFY FSM IMPLICATIONS                                     │
│     - Does this change involve entity state changes?               │
│     - If YES: route through the FSM engine (§8)                    │
│     - Check the FSM Catalog (§8.11) — is there an existing FSM?   │
│     - NEVER change state with direct assignment                    │
│                                                                     │
│  □ 6. PLAN THE CHANGE                                              │
│     - List every file you will create or modify                    │
│     - Verify each file is in the correct layer/directory           │
│     - Identify which tests need to be written or updated           │
│     - Identify which existing tests might break                    │
│                                                                     │
│  □ 7. ONLY NOW — WRITE CODE                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 20.3 Absolute Prohibitions — Things You Must NEVER Do

These are **hard stops**. If you find yourself about to do any of these, stop and reconsider.

#### 20.3.1 NEVER Create Duplicate Code

```
❌ PROHIBITED:
- Creating a new Button, Card, Modal, Spinner, EmptyState, Table, or any UI primitive
  when one exists in components/ (see §4.2 catalog)
- Creating a new HTTP fetch wrapper when api/client.ts exists
- Creating a new TanStack Query hook for an endpoint that already has one in api/hooks/
- Writing a raw SQL query in a handler or service when it belongs in adapter/postgres/
- Defining error types outside internal/domain/errors.go
- Creating a new config reader when internal/platform/config/ exists
- Duplicating validation logic that exists in the domain layer
- Creating a new logging setup when internal/platform/telemetry/ exists
- Writing inline Tailwind for patterns that exist as shared components

WHAT TO DO INSTEAD:
1. Search the codebase for the existing implementation
2. Import and use it
3. If it needs modification, extend it (add a prop, add a method) — not copy it
4. If it truly doesn't exist, create it in the CORRECT shared location
```

#### 20.3.2 NEVER Put Code in the Wrong Layer

```
❌ PROHIBITED:
- SQL queries in handlers or application services
- HTTP request/response types in the domain layer
- Business logic in handlers (handlers decode, validate, delegate, respond — nothing else)
- Direct database pool access in application services (use repository interfaces)
- Import from internal/adapter/ in internal/domain/ (dependency direction violation)
- Infrastructure concerns (logging setup, DB connections) in domain or app layers
- os.Getenv() calls anywhere except internal/platform/config/
- Global mutable variables (var db *pgxpool.Pool) anywhere

WHAT TO DO INSTEAD:
- Follow the dependency direction: cmd → handler → app → domain ← port ← adapter
- Consult Appendix A for exact placement
- If the function needs to cross a layer boundary, define an interface in internal/port/
```

#### 20.3.3 NEVER Take Shortcuts with State Transitions

```
❌ PROHIBITED:
- vehicle.State = "charging"  (direct state assignment)
- if vehicle.State == "online" { vehicle.State = "driving" }  (ad-hoc transition)
- switch entity.Status { case "pending": entity.Status = "active" }  (scattered logic)
- Changing FSM state outside a database transaction
- Changing FSM state without recording the transition in fsm_transitions

WHAT TO DO INSTEAD:
- Use fsmEngine.Fire(ctx, entity, currentState, event) — always
- Use fsmEngine.FireSub(ctx, entity, parentState, subEvent) for SubFSMs
- Wrap in a transaction: BEGIN → load with FOR UPDATE → Fire → persist → record history → COMMIT
- Consult the FSM Catalog (§8.11) for the correct FSM and events
```

#### 20.3.4 NEVER Skip Error Handling

```
❌ PROHIBITED:
- result, _ := someFunction()                    (ignoring error return)
- if err != nil { log.Error().Err(err) }         (logging without returning)
- if err != nil { return errors.New("failed") }  (discarding original error)
- catch (e) { console.log(e) }                   (swallowing frontend errors)
- try/catch around an entire function body        (catch-all that hides issues)

WHAT TO DO INSTEAD:
- ALWAYS check and return errors: if err != nil { return fmt.Errorf("context: %w", err) }
- Use domain error types from internal/domain/errors.go
- Map errors to HTTP status codes ONLY in the handler layer (§3.3)
- Frontend: use ErrorBoundary, ErrorDisplay, and TanStack Query error states
```

#### 20.3.5 NEVER Skip Context Propagation

```
❌ PROHIBITED:
- Functions doing I/O without context.Context as the first parameter
- http.Get(url) instead of http.NewRequestWithContext(ctx, "GET", url, nil)
- Using context.Background() when a request context is available
- Spawning goroutines without passing context

WHAT TO DO INSTEAD:
- EVERY function that does I/O takes ctx context.Context as first parameter
- EVERY external call uses context.WithTimeout(ctx, duration)
- EVERY goroutine uses errgroup with context
- OpenTelemetry trace propagation works through context — breaking the chain breaks tracing
```

#### 20.3.6 NEVER Create Raw HTML/CSS in Feature Components

```
❌ PROHIBITED (Frontend):
- <button className="bg-blue-600 text-white..."> in feature code (use Button)
- <input className="border rounded..."> in feature code (use Input)
- <table><thead><tr>... in feature code (use DataTable)
- <div className="flex flex-col gap-2 p-4 border rounded..."> for a card (use Card)
- import { LineChart } from 'recharts' in feature code (use TimeSeriesChart)
- import { MapContainer } from 'react-leaflet' in feature code (use components/maps/)
- import { motion } from 'framer-motion' in feature code (use components/motion/)
- style={{}} props except for truly dynamic computed values

WHAT TO DO INSTEAD:
- Import from @/components/ui, @/components/data-display, @/components/charts, etc.
- If the component doesn't exist, create it in the SHARED library first, then use it
- Follow the decision tree in §4.5
```

### 20.4 Mandatory Workflow — Step by Step

When the agent receives a coding task, follow this exact workflow. No deviations.

#### Phase 1: Research (DO NOT SKIP)

```
1. Read the task description carefully. Identify:
   - Which domain aggregate(s) are involved
   - Which layers will be touched
   - Whether FSM state changes are involved

2. Search the codebase THOROUGHLY:
   a. Search for existing types:
      grep -rn "type {EntityName}" internal/domain/
   b. Search for existing interfaces:
      grep -rn "interface" internal/port/
   c. Search for existing implementations:
      grep -rn "{FunctionName}" internal/adapter/ internal/app/
   d. Search for existing frontend components:
      find web/src/components/ -name "*.tsx" | sort
   e. Search for existing hooks:
      find web/src/hooks/ web/src/api/hooks/ -name "*.ts" | sort
   f. Search for existing SQL queries:
      grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/adapter/postgres/
   g. Search for the specific pattern/feature:
      grep -rn "{keyword}" internal/ web/src/

3. Read the files you found. Understand the patterns already in use.
   Do NOT proceed to writing code until you have a clear picture
   of what exists and what patterns are established.
```

#### Phase 2: Plan (DO NOT SKIP)

```
4. Write a plan that includes:
   - Every file you will create (with exact path)
   - Every file you will modify (with specific changes)
   - Which existing components/functions/hooks you will REUSE
   - Which tests you will write or update
   - Verification steps

5. Validate your plan against:
   - §2.2 Structural Rules (dependency direction)
   - §4.2 Reusable Component Library catalog (frontend)
   - §8.11 FSM Catalog (if state changes involved)
   - Appendix A ("Where Does This Code Go?")
   - Appendix B (Naming Conventions)

6. If ANYTHING in your plan creates a new file in a shared location
   (components/, hooks/, internal/domain/, internal/port/),
   verify there isn't already something that serves the same purpose.
```

#### Phase 3: Implement

```
7. Write code following EXACTLY the patterns in this document:
   - Go: §3 (packages, DI, errors, context, SQL, concurrency, config)
   - React: §4 (components, hooks, API layer, types, state, styling, i18n, a11y)
   - Database: §5 (migrations, connections, cache)
   - API: §6 (REST conventions, response envelope, validation)
   - FSM: §8 (engine, guards, hooks, SubFSMs, persistence, testing)
   - Errors: §10 (retry, circuit breaker, degradation)
   - Observability: §12 (structured logging, metrics, tracing)
   - Security: §13 (auth, secrets, input validation)

8. For every new function, component, or type you write, include:
   - Proper error handling (Go: wrapped errors; React: error boundaries)
   - Context propagation (Go: ctx as first param)
   - Observability (Go: zerolog + OTel spans; React: error reporting)
   - Type safety (Go: interfaces; TS: strict types, no any)
```

#### Phase 4: Test

```
9. Write tests for EVERY new behavior:
   - Go unit tests: table-driven, mocked interfaces from internal/port/
   - Go integration tests: testcontainers, build tags
   - React tests: Testing Library + MSW, smoke + interaction tests
   - FSM tests: all valid transitions + key invalid transitions + guard tests

10. Run existing tests to verify nothing is broken:
    - go test ./...
    - cd web && npm run test
    - go vet ./... && golangci-lint run
    - cd web && npm run lint && npx tsc --noEmit
```

#### Phase 5: Verify (DO NOT SKIP)

```
11. Self-review against the Code Review Checklist (§18):
    - Structural integrity (correct layer, no circular imports)
    - Duplication check (no new duplicates introduced)
    - Error handling (all errors handled or returned)
    - Testing (happy path + error cases)
    - Observability (logging, metrics, tracing)
    - Security (auth, validation, no secrets)
    - FSM (if applicable — transition table, guards, history)

12. Verify the Anti-Patterns Catalog (§17):
    - Did I introduce any backend anti-pattern (B1-B15)?
    - Did I introduce any frontend anti-pattern (F1-F15)?
    - If yes, fix BEFORE submitting.

13. Final check:
    - All tests pass
    - No linter warnings
    - No TypeScript errors
    - No new dependencies without justification
```

### 20.5 Backend-Specific Agent Rules

#### 20.5.1 Creating a New Domain Entity

```
MANDATORY STEPS (in order):
1. Define types in internal/domain/{entity}/types.go
   - Struct fields, validation methods, domain constants
   - ZERO external imports (no pgx, no http, no zerolog)

2. Define FSM (if stateful) in internal/domain/{entity}/fsm.go
   - States, events, transition table
   - Add to FSM Catalog (§8.11)

3. Define repository interface in internal/port/repository/{entity}.go
   - GetByID, List, Save, Delete — as needed
   - Use domain types only, not pgx types

4. Implement repository in internal/adapter/postgres/{entity}_repository.go
   - SQL queries as constants in adapter/postgres/queries/{entity}.go
   - pgx.CollectRows for type-safe scanning
   - Wrap errors with context

5. Define application service in internal/app/{entity}svc/service.go
   - Constructor injection of port interfaces
   - Use cases as methods
   - Transaction management if multi-step

6. Define DTOs in internal/handler/dto/{entity}.go
   - Request/response types with validation tags
   - Conversion functions: FromDomain(), ToDomain()

7. Define handler in internal/handler/v1/{entity}_handler.go
   - Register(r chi.Router) method
   - Each handler method: decode → validate → delegate to service → respond

8. Wire in cmd/{binary}/main.go
   - Instantiate adapter → service → handler → register routes

9. Write migration in migrations/NNNNNN_{description}.{up,down}.sql
   - Both up AND down migrations
   - Idempotent (IF NOT EXISTS)

10. Write tests:
    - internal/domain/{entity}/ — unit tests for validation, FSM
    - internal/app/{entity}svc/ — unit tests with mocked ports
    - internal/adapter/postgres/ — integration tests with testcontainers
    - internal/handler/v1/ — httptest handler tests

DO NOT skip steps. DO NOT combine layers. DO NOT put SQL in services.
```

#### 20.5.2 Adding a New API Endpoint

```
MANDATORY STEPS:
1. Add DTO (request/response) to internal/handler/dto/
2. Add use case method to the application service in internal/app/
3. Add repository method if new data access is needed (interface → implementation)
4. Add handler method in internal/handler/v1/
5. Register route in the handler's Register() method
6. Add middleware (auth, rate limit) as appropriate
7. Add structured logging, metrics, tracing to the new path
8. Write handler test with httptest
9. Update API documentation if it exists

NEVER add an endpoint directly in cmd/main.go.
NEVER put business logic in the handler.
NEVER skip auth middleware on user-facing endpoints.
```

#### 20.5.3 Writing SQL

```
MANDATORY RULES:
- ALL queries live in internal/adapter/postgres/queries/ as named constants
- ALL queries use parameterized placeholders ($1, $2, ...) — NEVER string concatenation
- ALL queries are called from the repository implementation, never from services or handlers
- Timestamps: ALWAYS timestamptz, NEVER timestamp
- IDs: UUIDv7 generated by the application
- Indexes: CREATE INDEX CONCURRENTLY (in migrations)
- Test every query in an integration test with a real Postgres (testcontainers)

NEVER write: fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)
ALWAYS write: pool.QueryRow(ctx, "SELECT * FROM users WHERE name = $1", name)
```

### 20.6 Frontend-Specific Agent Rules

#### 20.6.1 Creating a New Feature Page

```
MANDATORY STEPS (in order):
1. Create the TanStack Query hook in web/src/api/hooks/use{Feature}.ts
   - Define query key factory
   - Define useQuery/useMutation hooks
   - Type-safe API responses from web/src/types/

2. Create feature components in web/src/features/{feature}/components/
   - COMPOSE from shared components (components/ui, data-display, charts, etc.)
   - DO NOT create raw <button>, <input>, <table>, <div class="card..."> elements
   - Check §4.2 catalog before creating any UI element

3. Create the page component in web/src/features/{feature}/pages/
   - Use PageContainer for the page wrapper
   - Pass loading/error/empty states to PageContainer — do not handle manually

4. Add the route in web/src/routes/
   - Use React.lazy() for the page component (code splitting)
   - Wrap in LazyRoute (Suspense fallback)

5. Add translations in web/src/i18n/locales/{lang}/{feature}.json
   - All user-facing strings use i18next — no hardcoded text

6. Write tests:
   - Component smoke tests (renders without crashing)
   - User interaction tests (clicks, form submissions)
   - API hook tests with MSW handlers

NEVER bypass the shared component library.
NEVER use fetch() or axios directly — use api/client.ts via hooks.
NEVER use useEffect for data fetching — use useQuery.
NEVER use any type — define proper types in web/src/types/.
```

#### 20.6.2 Creating a New Shared Component

```
MANDATORY STEPS:
1. Verify it doesn't already exist (search components/ thoroughly)
2. Identify the correct subcategory:
   - UI primitive → components/ui/
   - Layout → components/layout/
   - Feedback → components/feedback/
   - Data display → components/data-display/
   - Chart → components/charts/
   - Map → components/maps/
   - Form → components/forms/
   - Animation → components/motion/

3. Design the component API:
   - Accept className prop, merge with cn()
   - Use forwardRef for DOM-wrapping components
   - Expose variant/size props with typed unions (not strings)
   - Support children or slot props for composition
   - Include aria-* attributes for accessibility

4. Implementation rules:
   - Max 200 lines per file
   - No business logic
   - No API calls
   - No feature-specific imports
   - Dark mode support (dark: variants)
   - Responsive (mobile-first Tailwind)

5. Export from the barrel index file:
   - Add to components/{category}/index.ts

6. Write tests:
   - Smoke test: renders with default props
   - Variant test: each variant/size renders correctly
   - Interaction test: onClick, onChange, etc.
   - Accessibility test: roles, aria attributes, keyboard nav

7. Document usage with at least one example in the test file or a comment.
```

#### 20.6.3 Reusing Existing Components — Lookup Order

When you need any UI element, follow this exact lookup order. **Stop at the first match.**

```
1. components/ui/          → Button, Badge, Card, Input, Modal, Select, Tabs, Toggle, Tooltip
2. components/layout/      → PageContainer, Stack, Grid, Section, SplitPane, Header
3. components/feedback/    → Spinner, Skeleton, ErrorDisplay, EmptyState, Toast, ProgressBar, Banner
4. components/data-display/ → DataTable, StatCard, KVList, Timeline, Metric, DescriptionList
5. components/charts/      → ChartContainer, TimeSeriesChart, BarChart, GaugeChart, PieChart
6. components/maps/        → MapContainer, MapMarker, MapRoute, MapCluster, MapBounds
7. components/forms/       → FormField, FormSection, SearchInput, DateRangePicker, NumberInput
8. components/motion/      → FadeIn, SlideIn, AnimatedList, AnimatedNumber, Collapse
9. hooks/                  → useDebounce, useMediaQuery, useLocalStorage, useConfirm, etc.

If you find a match: IMPORT AND USE IT.
If it needs a small addition: ADD A PROP to the shared component.
If nothing matches: CREATE in the correct shared category, THEN use it.
NEVER create a one-off version in a feature folder when a shared version should exist.
```

### 20.7 Database-Specific Agent Rules

```
MANDATORY RULES:

Migration files:
- Sequential numbering: NNNNNN_{description}.up.sql + .down.sql
- NEVER edit an existing migration — create a new one
- Include IF NOT EXISTS / IF EXISTS guards
- Use CONCURRENTLY for index creation
- Test both up AND down migrations

Schema:
- Table names: snake_case, plural (vehicles, charging_sessions)
- Column names: snake_case (display_name, created_at)
- All timestamps: timestamptz (NEVER timestamp without timezone)
- All PKs: UUID (application-generated UUIDv7)
- Soft deletes: deleted_at timestamptz column
- FSM state: fsm_state TEXT NOT NULL DEFAULT '{initial_state}'
- SubFSM state: sub_fsm_state TEXT (nullable)
- Indexes named: idx_{table}_{columns}

Redis:
- EVERY value has a TTL — Redis is a CACHE, not a database
- Key format: teslasync:{entity}:{id}:{subresource}
- Cache-aside (read-through) pattern by default
- System MUST function (degraded) when Redis is down

MongoDB:
- ONLY used for raw Fleet Telemetry with 7-day TTL
- Append-only — never update documents
- Processed data goes to PostgreSQL
```

### 20.8 Observability Agent Rules

```
MANDATORY for every new code path:

Logging (zerolog):
- Structured JSON only — no fmt.Println, no log.Println
- Consistent field names (see §12.1 field table)
- Error level: actual failures
- Warn level: degradation (cache miss fallback, retry)
- Info level: business events (vehicle synced, trip completed)
- Debug level: development diagnostics
- NEVER log tokens, passwords, PII, or sensitive data

Metrics (Prometheus):
- Every new endpoint: request count + duration histogram
- Every new external call: call count + duration + error rate
- Naming: teslasync_{subsystem}_{metric}_{unit}
- Labels: low cardinality only (method, endpoint, status — NOT user_id, vin)

Tracing (OpenTelemetry):
- Every new function that does I/O: create a child span
- Span name: {Package}.{Function} (e.g., "VehicleRepository.GetByID")
- Add relevant attributes (entity IDs, operation type)
- Propagate context — NEVER break the trace chain
```

### 20.9 Test-Writing Agent Rules

```
MANDATORY for every code change:

Go Tests:
- Unit tests for domain logic: table-driven, no I/O, ≥90% coverage
- Unit tests for services: mocked interfaces from internal/port/, ≥80% coverage
- Integration tests for adapters: testcontainers, build tag, ≥70% coverage
- Handler tests with httptest: test request decoding, validation, response shape
- FSM tests: all valid transitions + key invalid transitions + guard rejection
- Name format: TestFunctionName_Scenario (e.g., TestGetVehicle_NotFound)

React Tests:
- Smoke test: renders with required props without crashing
- Content test: displays expected text/data
- Interaction test: click, type, submit — verify behavior
- Loading/error test: verify loading spinner, error display
- API hook tests: MSW handlers, not mocked internals
- Name format: describe('ComponentName') → it('does specific thing')

General:
- Tests MUST be deterministic (no time.Now() without mocking, no Math.random())
- Tests MUST NOT depend on external services
- Tests MUST clean up after themselves
- Tests MUST run in CI without special environment variables

NEVER skip writing tests. NEVER claim "tests can be added later."
```

### 20.10 Commit Message and PR Rules

```
Commit messages:
- Format: type(scope): description
- Types: feat, fix, refactor, test, docs, chore, perf, ci
- Scope: the domain aggregate or feature (vehicle, charging, trip, export, dashboard)
- Description: imperative mood, lowercase, no period
- Body: explain WHY, not just WHAT (if non-obvious)
- Always include: Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>

Examples:
  feat(charging): add SubFSM for charging phase tracking
  fix(vehicle): prevent concurrent FSM transitions with row lock
  refactor(trips): migrate scattered SQL to repository pattern
  test(dashboard): add StatCard component tests

PR rules:
- < 400 lines of logic changes per PR
- Title matches the commit message format
- Description explains: what changed, why, how to test
- All CI checks pass before requesting review
- Self-reviewed against the Code Review Checklist (§18)
```

### 20.11 Common Agent Mistakes — Explicit Corrections

These are patterns that AI agents frequently produce incorrectly. Read and memorize these.

#### Mistake 1: Inlining Everything in the Handler

```go
// ❌ WHAT AGENTS OFTEN PRODUCE — a "god handler" that does everything
func (h *Handler) CreateVehicle(w http.ResponseWriter, r *http.Request) {
    var req struct {
        VIN  string `json:"vin"`
        Name string `json:"name"`
    }
    json.NewDecoder(r.Body).Decode(&req)

    // Validation mixed with business logic mixed with DB access
    if len(req.VIN) != 17 {
        http.Error(w, "bad vin", 400)
        return
    }

    var id string
    err := h.db.QueryRow(r.Context(),
        "INSERT INTO vehicles (vin, name) VALUES ($1, $2) RETURNING id",
        req.VIN, req.Name).Scan(&id)
    if err != nil {
        http.Error(w, "db error", 500)
        return
    }

    json.NewEncoder(w).Encode(map[string]string{"id": id})
}

// ✅ WHAT YOU MUST PRODUCE INSTEAD — proper layered architecture
// 1. DTO in handler/dto/vehicle.go
type CreateVehicleRequest struct {
    VIN         string `json:"vin" validate:"required,len=17"`
    DisplayName string `json:"displayName" validate:"required,min=1,max=100"`
}

// 2. Handler in handler/v1/vehicle_handler.go
func (h *VehicleHandler) Create(w http.ResponseWriter, r *http.Request) {
    req, err := dto.DecodeAndValidate[dto.CreateVehicleRequest](r)
    if err != nil {
        dto.RespondError(w, err)
        return
    }
    vehicle, err := h.service.Create(r.Context(), req.ToDomain())
    if err != nil {
        dto.RespondError(w, err)
        return
    }
    dto.Respond(w, http.StatusCreated, dto.VehicleFromDomain(vehicle))
}

// 3. Service in app/vehiclesvc/service.go
func (s *Service) Create(ctx context.Context, v *vehicle.Vehicle) (*vehicle.Vehicle, error) {
    v.ID = generateUUIDv7()
    v.FSMState = vehicle.StateUnknown
    if err := s.repo.Save(ctx, v); err != nil {
        return nil, fmt.Errorf("saving vehicle: %w", err)
    }
    return v, nil
}

// 4. Repository in adapter/postgres/vehicle_repository.go
func (r *vehicleRepository) Save(ctx context.Context, v *vehicle.Vehicle) error {
    _, err := r.pool.Exec(ctx, queries.UpsertVehicle,
        v.ID, v.UserID, v.VIN, v.DisplayName, v.FSMState, v.CreatedAt, v.UpdatedAt)
    if err != nil {
        return fmt.Errorf("upsert vehicle %s: %w", v.ID, err)
    }
    return nil
}
```

#### Mistake 2: Creating Feature-Local UI Components

```tsx
// ❌ WHAT AGENTS OFTEN PRODUCE — custom components in features/
// features/vehicles/components/VehicleMetricCard.tsx
function VehicleMetricCard({ label, value, icon }: Props) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{label}</span>
        {icon}
      </div>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  );
}

// ✅ WHAT YOU MUST PRODUCE INSTEAD — use the shared StatCard
// features/vehicles/components/VehicleStats.tsx
import { StatCard } from '@/components/data-display/StatCard';
import { Grid } from '@/components/layout/Grid';

function VehicleStats({ vehicle }: { vehicle: Vehicle }) {
  return (
    <Grid cols={{ default: 2, lg: 4 }} gap={4}>
      <StatCard label="Battery" value={`${vehicle.batteryLevel}%`} icon={<Battery />} />
      <StatCard label="Range" value={vehicle.range} unit="mi" icon={<Navigation />} />
      <StatCard label="Odometer" value={vehicle.odometer} unit="mi" icon={<Gauge />} />
      <StatCard label="State" value={vehicle.fsmState} icon={<Activity />} />
    </Grid>
  );
}
```

#### Mistake 3: Ad-Hoc State Changes

```go
// ❌ WHAT AGENTS OFTEN PRODUCE
func (s *Service) StartCharging(ctx context.Context, vehicleID string) error {
    vehicle, _ := s.repo.GetByID(ctx, vehicleID)
    vehicle.State = "charging"  // direct assignment!
    s.repo.Save(ctx, vehicle)
    return nil
}

// ✅ WHAT YOU MUST PRODUCE INSTEAD
func (s *Service) StartCharging(ctx context.Context, vehicleID string) error {
    tx, err := s.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback(ctx)

    vehicle, err := s.repo.WithTx(tx).GetByIDForUpdate(ctx, vehicleID)
    if err != nil {
        return fmt.Errorf("load vehicle: %w", err)
    }

    oldState := vehicle.FSMState
    newState, err := s.fsmEngine.Fire(ctx, vehicle, vehicle.FSMState, vehicle.EventPlugIn)
    if err != nil {
        return fmt.Errorf("fsm transition: %w", err)
    }

    vehicle.FSMState = newState
    if err := s.repo.WithTx(tx).Save(ctx, vehicle); err != nil {
        return fmt.Errorf("save vehicle: %w", err)
    }

    if err := s.fsmHistory.WithTx(tx).RecordTransition(ctx, FSMTransitionRecord{
        EntityType: "vehicle",
        EntityID:   vehicleID,
        FSMName:    "vehicle_lifecycle",
        FromState:  string(oldState),
        ToState:    string(newState),
        Event:      "plug_in",
    }); err != nil {
        return fmt.Errorf("record transition: %w", err)
    }

    return tx.Commit(ctx)
}
```

#### Mistake 4: Bare fetch/useEffect for Data

```tsx
// ❌ WHAT AGENTS OFTEN PRODUCE
function VehicleList() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/vehicles')
      .then(r => r.json())
      .then(data => { setVehicles(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  return vehicles.map(v => <div key={v.id}>{v.name}</div>);
}

// ✅ WHAT YOU MUST PRODUCE INSTEAD
import { useVehicles } from '@/api/hooks/useVehicles';
import { PageContainer } from '@/components/layout/PageContainer';
import { DataTable } from '@/components/data-display/DataTable';

function VehicleListPage() {
  const { data: vehicles, isLoading, error } = useVehicles();

  return (
    <PageContainer
      title={t('vehicles.title')}
      loading={isLoading}
      error={error}
      empty={vehicles?.length === 0}
    >
      <DataTable
        columns={vehicleColumns}
        data={vehicles!}
        keyExtractor={(v) => v.id}
        onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
      />
    </PageContainer>
  );
}
```

#### Mistake 5: Scattered Configuration

```go
// ❌ WHAT AGENTS OFTEN PRODUCE
func connectDB() *pgxpool.Pool {
    host := os.Getenv("DB_HOST")
    port := os.Getenv("DB_PORT")
    if port == "" { port = "5432" }
    // ... scattered env var reading
}

// ✅ WHAT YOU MUST PRODUCE INSTEAD
// All config is in internal/platform/config/config.go — read it there
// In cmd/main.go:
cfg := config.MustLoad()
pool := database.MustConnect(cfg.Database)
```

### 20.12 Honesty Policy — No Premature Completion Claims

> **AI agents have a known failure mode: claiming work is complete when it is not.
> When challenged ("are you sure?"), they backtrack. This is unacceptable.**

#### 20.12.1 Rules for Honest Status Reporting

| Rule | Details |
|------|---------|
| **No completion claims without proof** | "I believe it's done" is not proof. Test output, build output, and grep verification ARE proof. You must run commands and show output. |
| **Never say "yes, all done" reflexively** | Before saying "complete", go back to your plan and verify EVERY item. List each item with ✅/❌/⚠️ status. |
| **When the user asks "are you sure?"** | This means they suspect you're wrong. Do NOT reflexively confirm. Re-examine your work, run verification commands, and give an honest answer with evidence. |
| **Partial completion is acceptable** | "I completed 7 of 10 items, here's what's remaining" is a GOOD answer. "All done" when 3 items are missing is DISHONEST and wastes the user's time. |
| **List what you did NOT do** | Every completion report must include a "Not Completed" section, even if it's empty. This forces you to think about what's missing. |
| **No hidden TODOs** | If you left `// TODO` or `// FIXME` comments that are part of the task scope, those are NOT completed — they are deferred work. Say so. |

#### 20.12.2 Mandatory Completion Report Format

Every time the agent reports completion, use this format:

```markdown
## Completion Report

### Completed
- ✅ [Item 1] — [file path] — [what was done]
- ✅ [Item 2] — [file path] — [what was done]

### Not Completed
- ❌ [Item] — [why] — [what would finish it]
(or "None — all planned items are implemented" if truly everything is done)

### Known Issues / Shortcuts
- ⚠️ [any edge cases, compromises, or things that could be better]
(or "None" if there genuinely aren't any)

### Verification Output
[Paste actual test/build/lint command output — not a summary, the actual output]
```

#### 20.12.3 Verification Commands — Must Run, Must Show Output

```bash
# Backend — run ALL, paste output
go build ./...
go test ./...
golangci-lint run ./...

# Frontend — run ALL, paste output
cd web && npx tsc --noEmit
cd web && npm run lint
cd web && npm run test
```

**"All tests pass" without showing output = dishonest. Paste the actual output.**

If any command fails, FIX THE ISSUE before claiming completion. If you cannot fix it,
report it honestly in the "Known Issues" section.

#### 20.12.4 Plan Item Verification

Go back to the plan from Phase 2 and check EVERY item:

```
For EACH planned item, verify and state:
  ✅ DONE   — [file exists, implementation matches plan]
  ❌ MISSED — [file missing, or implementation incomplete]
  ⚠️ PARTIAL — [partially done, describe what's missing]
```

Do NOT say "all items are done" without going through them one by one. The human WILL
check, and discovering a lie wastes more time than hearing "2 items remaining."

### 20.13 Agent Self-Verification Checklist

Before submitting ANY code change, the agent must answer ALL of these questions. If any answer is "no" or "unsure", fix it before proceeding.

```
STRUCTURE
  ✓ Is every new file in the correct directory per Appendix A?
  ✓ Does the dependency direction hold? (domain has no adapter imports)
  ✓ Are there any circular imports?

DUPLICATION
  ✓ Did I search for existing code before writing new code?
  ✓ Am I reusing shared components (components/) instead of creating new ones?
  ✓ Am I reusing existing hooks instead of writing new ones?
  ✓ Am I reusing existing utility functions from lib/?
  ✓ Is every SQL query in adapter/postgres/queries/?

PATTERNS
  ✓ Are state transitions going through the FSM engine?
  ✓ Are all errors wrapped with context and returned (not swallowed)?
  ✓ Does every I/O function accept context.Context?
  ✓ Are external calls wrapped with timeout + retry + circuit breaker?
  ✓ Is configuration read from config.MustLoad(), not os.Getenv()?

FRONTEND
  ✓ Am I using components from the shared library, not raw HTML?
  ✓ Am I using TanStack Query hooks, not fetch/useEffect?
  ✓ Am I using i18next, not hardcoded strings?
  ✓ Does every interactive element have proper a11y?
  ✓ Do new shared components have barrel exports?

QUALITY
  ✓ Did I write tests for all new behavior?
  ✓ Do tests cover happy path AND error cases?
  ✓ Are there no TypeScript `any` types?
  ✓ Are there no Go linter violations?
  ✓ Would this pass the Code Review Checklist (§18)?

OBSERVABILITY
  ✓ Are new code paths logged with structured zerolog?
  ✓ Are new external calls instrumented with metrics + tracing?
  ✓ Are sensitive fields excluded from logs?
```

### 20.13 Handling Ambiguous Requirements

**Rule: When requirements are ambiguous, STOP and ask — do not guess.**

```
AMBIGUITY TRIGGERS — if any of these apply, ask before coding:
- The task could be interpreted in 2+ significantly different ways
- The task touches security-sensitive code (auth, encryption, PII)
- The task involves destructive operations (data deletion, schema migration)
- The task requires choosing between multiple valid architectural approaches
- The task affects a public API contract (response shape, error codes)
- You cannot determine the correct FSM state/event from the description

HOW TO ASK:
1. State what you understood
2. List the options you see with tradeoffs
3. Recommend one option with justification
4. Ask the user to confirm or choose
```

### 20.14 Handling Legacy Violations

**Rule: Do not copy legacy anti-patterns. Do not silently perpetuate them.**

```
When you encounter existing code that violates these guidelines:

1. IF the violation is in code you are directly modifying:
   → Fix it as part of your change (boy scout rule)
   → Mention the fix in the PR description

2. IF the violation is in adjacent code you are NOT modifying:
   → Do NOT copy the pattern into your new code
   → Follow the guidelines in your new code
   → Add a TODO comment: // TODO: refactor to follow §X.Y guidelines
   → Create a follow-up issue if the violation is significant

3. IF multiple legacy patterns exist and conflict:
   → Follow THESE GUIDELINES, not the legacy code
   → The guidelines are the source of truth, not existing code

ORDER OF PRECEDENCE:
   1. This engineering guidelines document
   2. ADR decisions in docs/adr/
   3. Patterns established in the most recently refactored code
   4. Legacy code (lowest priority — never copy without validating)
```

### 20.15 Handling Breaking Changes

**Rule: NEVER make a breaking change without explicit approval and a migration plan.**

```
BEFORE making any of these changes, STOP and seek approval:

BREAKING CHANGES (require ADR + approval):
- Removing or renaming an API field, endpoint, or error code
- Changing a database column type, removing a column, or changing constraints
- Modifying an FSM transition table (removing transitions, changing states)
- Changing a shared component's required props or behavior
- Removing or renaming an exported Go type, function, or interface
- Changing the shape of MQTT messages or Redis key formats

PROCESS:
1. Identify all consumers/dependents of the thing you're changing
2. Write an ADR with: justification, impact, migration plan, rollback plan
3. Get approval from the engineering lead + affected team(s)
4. Implement using expand-contract pattern (§5.7):
   a. EXPAND: add new version alongside old
   b. MIGRATE: move consumers to new version
   c. CONTRACT: remove old version only when all consumers migrated
5. Never ship EXPAND and CONTRACT in the same PR/deploy
```

### 20.16 Updating Collateral Artifacts

**Rule: Code changes are not complete until all related artifacts are updated.**

```
When your change affects:    You MUST also update:
─────────────────────────    ──────────────────────
API endpoint behavior    →   OpenAPI spec (docs/api/openapi.yaml)
Database schema          →   Migration (up + down) + ER diagram
FSM transitions          →   FSM Catalog (§8.11) + FSM tests
Shared component API     →   Barrel export (index.ts) + tests
Configuration            →   values.yaml + env var documentation
Alerting thresholds      →   Runbook (docs/runbooks/)
Architecture decision    →   ADR (docs/adr/)
New external dependency  →   License check + security review
```

---

## 21. Performance Budgets & SLOs

### 21.1 Backend Latency Targets

| Endpoint Class | p50 | p95 | p99 | Max |
|----------------|-----|-----|-----|-----|
| Simple read (by ID) | 10 ms | 50 ms | 100 ms | 500 ms |
| List/search (paginated) | 30 ms | 100 ms | 200 ms | 1 s |
| Write (create/update) | 20 ms | 80 ms | 150 ms | 1 s |
| External API proxy (Tesla) | 200 ms | 1 s | 3 s | 10 s |
| Background worker task | N/A | N/A | N/A | 5 min |
| WebSocket/SSE push | 50 ms | 100 ms | 200 ms | 500 ms |

**Rule: Latency targets are measured at the application layer (handler entry to response write), not including network transit.**

### 21.2 Database Query Budgets

| Query Type | Max Duration | Max Queries per Request |
|------------|-------------|------------------------|
| Point lookup (PK or unique index) | 5 ms | Unlimited (within request budget) |
| Index scan | 20 ms | 5 per request |
| Sequential scan | Not allowed on tables > 10k rows | 0 |
| Aggregation / GROUP BY | 100 ms | 2 per request |
| Total DB time per request | 50 ms (p95) | 10 queries |

**Rule: N+1 queries are banned. Use JOINs, batch queries, or DataLoader patterns.**

### 21.3 Frontend Performance Budgets

| Metric | Budget | Measured By |
|--------|--------|-------------|
| **Initial JS bundle** (gzipped) | < 200 KB | Vite build output, CI check |
| **Per-route chunk** (gzipped) | < 80 KB | Vite build output |
| **Total transferred** (first load) | < 500 KB | Lighthouse CI |
| **LCP** (Largest Contentful Paint) | < 2.5 s | Web Vitals, RUM |
| **INP** (Interaction to Next Paint) | < 200 ms | Web Vitals, RUM |
| **CLS** (Cumulative Layout Shift) | < 0.1 | Web Vitals, RUM |
| **TTI** (Time to Interactive) | < 3.5 s | Lighthouse CI |
| **Build time** | < 30 s | CI timer |

**CI enforcement:**
- `bundlesize` or equivalent checks run on every PR. Regression > 10% blocks merge.
- Lighthouse CI runs on staging after deploy. Score < 90 (performance) creates a ticket.

### 21.4 Caching Strategy Hierarchy

| Layer | Cache | TTL | Invalidation | Stampede Protection |
|-------|-------|-----|-------------|---------------------|
| **L1: Browser** | TanStack Query in-memory | `staleTime: 30s` | `invalidateQueries()` on mutation | Built-in dedup |
| **L2: CDN/Edge** | Nginx `proxy_cache` | 60s for static, no-cache for API | `Cache-Control` headers | — |
| **L3: Application** | Redis (`cache-aside`) | 15s–5min per entity type | Delete-on-write + TTL | Singleflight / lock |
| **L4: Database** | PostgreSQL shared_buffers | OS-managed | Automatic | — |

**Singleflight pattern (prevents cache stampede):**
```go
// internal/platform/cache/singleflight.go
var group singleflight.Group

func GetVehicleState(ctx context.Context, id string) (*State, error) {
    val, err, _ := group.Do("vehicle:"+id, func() (interface{}, error) {
        // Only one goroutine fetches; others wait for the result
        return fetchAndCacheVehicleState(ctx, id)
    })
    return val.(*State), err
}
```

---

## 22. Incident Management & Operations

### 22.1 Severity Levels

| Level | Definition | Response Time | Comms Cadence | Example |
|-------|-----------|---------------|---------------|---------|
| **SEV1** | Service outage affecting all users | 15 min | Every 30 min | API returning 5xx to all requests |
| **SEV2** | Significant degradation or partial outage | 30 min | Every 2 hours | Vehicle sync failing for 50% of users |
| **SEV3** | Minor feature broken, workaround exists | 4 hours | Daily | Export worker stuck, manual export possible |
| **SEV4** | Cosmetic issue, no user impact | Next business day | On resolution | Dashboard chart misaligned |

### 22.2 On-Call Rotation

| Property | Policy |
|----------|--------|
| Rotation | Weekly, rotating among all backend + infra engineers |
| Primary | Carries pager, responds within 15 min (SEV1/2) |
| Secondary | Backup, responds within 30 min if primary unavailable |
| Handoff | End of business day on rotation day, with written summary |
| Compensation | As per team policy (time off in lieu or on-call stipend) |
| Escalation | Primary → Secondary → Engineering Lead → CTO |

### 22.3 Postmortem Process

**Rule: Every SEV1 and SEV2 incident gets a blameless postmortem within 5 business days.**

**Template:** `docs/postmortems/YYYY-MM-DD-title.md`

```markdown
# Postmortem: [Title]
Date: YYYY-MM-DD | Duration: Xh Ym | Severity: SEV1/2
Author: [Name] | Reviewers: [Names]

## Summary
One paragraph: what happened, user impact, duration.

## Timeline (UTC)
- HH:MM — First alert / detection
- HH:MM — Incident declared, commander assigned
- HH:MM — Root cause identified
- HH:MM — Fix deployed
- HH:MM — Service restored, incident closed

## Root Cause
What actually broke and why.

## Impact
Users affected, data lost, SLO impact, revenue impact.

## What Went Well
- Detection was fast because...
- Runbook worked because...

## What Went Wrong
- Took too long to identify because...
- Rollback was delayed because...

## Action Items
| # | Action | Owner | Deadline | Status |
|---|--------|-------|----------|--------|
| 1 | Add missing alert for X | @engineer | YYYY-MM-DD | Open |
| 2 | Fix root cause Y | @engineer | YYYY-MM-DD | Open |
| 3 | Update runbook Z | @engineer | YYYY-MM-DD | Open |

## Lessons Learned
What will we do differently?
```

### 22.4 Runbook Standards

**Rule: Every production alert has a corresponding runbook. Runbooks are tested during DR drills.**

**Location:** `docs/runbooks/`

**Required sections:**
1. **Symptoms** — What does the alert look like? What will the on-call see?
2. **Impact** — What is broken for users?
3. **Investigation steps** — Specific commands, dashboards, queries to run
4. **Remediation** — Step-by-step fix procedures
5. **Escalation** — When and to whom
6. **Prevention** — What change would prevent recurrence?

### 22.5 Tech Debt Tracking

| Category | How Tracked | Review Cadence | Retirement Target |
|----------|-------------|----------------|-------------------|
| Code-level debt | `// TODO(debt):` comments + GitHub issues labeled `tech-debt` | Sprint planning | 20% of sprint capacity |
| Architecture debt | ADRs marked `Needs Review` | Quarterly architecture review | Per-ADR timeline |
| Test debt | Coverage gaps in CI report | Monthly | Coverage targets in §11.4 |
| Security debt | `govulncheck` + Trivy findings below SLA | Weekly triage | Per §13.5 SLA |
| Feature flag debt | Flags older than 30 days post-rollout | Sprint planning | 30-day max |

---

## 23. Release Engineering

### 23.1 Branching Model

```
main ──────────────────────────────────────────────── (always deployable)
  │
  ├── feat/vehicle-subfsm ─────── (PR → squash merge → main)
  ├── fix/charging-cost-calc ───── (PR → squash merge → main)
  ├── hotfix/auth-bypass ──────── (PR → merge → main + cherry-pick to release)
  │
  └── release/v2.1 ────────────── (cut from main for major releases only)
```

**Rules:**
- `main` is always deployable. Never push broken code.
- Feature branches are short-lived (< 1 week). Longer branches must rebase daily.
- Release branches are only created for major versions that need parallel maintenance.
- Hotfix branches are cut from the latest release tag, not from `main`.

### 23.2 Versioning

**Format:** `vMAJOR.MINOR.PATCH` (e.g., `v2.1.3`)

| Component | Versioned? | Strategy |
|-----------|-----------|----------|
| API (`/api/v1/`) | Yes | URL path versioning. Major bumps only. |
| Docker images | Yes | `ghcr.io/org/teslasync:v2.1.3` + `ghcr.io/org/teslasync:sha-abc123` |
| Helm chart | Yes | `Chart.yaml` version tracks app version |
| Database schema | Yes | Migration sequence number (000001, 000002, ...) |
| Frontend | No separate version | Bundled with API release |

### 23.3 Changelog

**Format:** [Keep a Changelog](https://keepachangelog.com/) standard.

```markdown
# Changelog

## [2.1.3] - 2026-04-12
### Fixed
- Charging cost calculation rounding error (#142)
- Vehicle FSM stuck in "unknown" after Tesla API timeout (#145)

### Changed
- Improved geocoding fallback chain reliability

## [2.1.2] - 2026-04-05
### Added
- Export to CSV with custom date ranges (#138)
### Security
- Updated go.mod dependencies (govulncheck clean)
```

**Rule: Every release has a changelog entry. Auto-generated from conventional commits, human-reviewed before publish.**

---

## 24. Governance & Ownership

### 24.1 CODEOWNERS

**Rule: Every directory has an explicit owner. PRs require approval from the relevant owner.**

```
# .github/CODEOWNERS
# Default owner
*                                   @teslasync/engineering-lead

# Backend
/internal/domain/                   @teslasync/backend
/internal/app/                      @teslasync/backend
/internal/adapter/                  @teslasync/backend
/internal/handler/                  @teslasync/backend
/internal/platform/                 @teslasync/backend
/cmd/                               @teslasync/backend

# Frontend
/web/                               @teslasync/frontend
/web/src/components/                @teslasync/frontend-leads

# Database & Migrations
/migrations/                        @teslasync/backend @teslasync/dba

# Infrastructure & Security
/deploy/                            @teslasync/infra
/.github/workflows/                 @teslasync/infra
/docs/runbooks/                     @teslasync/infra

# Security-sensitive
/internal/platform/auth/            @teslasync/security
/internal/adapter/tesla/            @teslasync/backend @teslasync/security
/internal/platform/config/          @teslasync/backend @teslasync/infra

# Guidelines & Architecture
/ENGINEERING_GUIDELINES.md          @teslasync/engineering-lead
/.github/copilot-instructions.md    @teslasync/engineering-lead
/docs/adr/                          @teslasync/engineering-lead
```

### 24.2 RFC Process for Architectural Changes

**Rule: Changes that affect shared interfaces, data models, or cross-cutting concerns require an RFC (written as an ADR).**

**RFC threshold — an RFC is required when:**
- Adding or removing a database table or column affecting > 1 service
- Changing a port interface in `internal/port/`
- Adding a new FSM or modifying an existing transition table
- Adding a new external dependency or service integration
- Changing the authentication or authorization model
- Modifying the CI/CD pipeline or deployment strategy
- Changing a shared React component's API (props)

**RFC template:** `docs/adr/NNNN-title.md`

```markdown
# ADR-NNNN: [Title]
Status: Proposed | Accepted | Deprecated | Superseded
Date: YYYY-MM-DD
Author: [Name]
Reviewers: [Names]

## Context
What is the problem or opportunity?

## Decision
What are we going to do?

## Alternatives Considered
What else did we evaluate and why did we reject it?

## Consequences
What are the positive, negative, and neutral outcomes?

## Migration Plan
How do we get from here to there? (expand-contract, feature flag, etc.)
```

### 24.3 Dependency Update Policy

| Dependency Type | Tool | Cadence | Auto-merge? |
|-----------------|------|---------|-------------|
| Go patch versions | Dependabot | Weekly | Yes, if CI passes |
| Go minor versions | Dependabot | Weekly | No — requires review |
| Go major versions | Manual | Quarterly evaluation | No — requires ADR |
| npm patch versions | Renovate | Weekly | Yes, if CI passes |
| npm minor versions | Renovate | Weekly | No — requires review |
| npm major versions | Manual | Quarterly evaluation | No — requires ADR |
| Docker base images | Renovate | Weekly (digest updates) | No — requires review |
| GitHub Actions | Dependabot | Weekly | No — pin to SHA, review changes |

### 24.4 License Compliance

| Allowed | Restricted (ADR required) | Prohibited |
|---------|--------------------------|------------|
| MIT | MPL-2.0 | GPL-2.0 |
| BSD-2-Clause | LGPL-2.1 (dynamic link only) | GPL-3.0 |
| BSD-3-Clause | EUPL-1.2 | AGPL-3.0 |
| Apache-2.0 | Artistic-2.0 | SSPL |
| ISC | CC-BY-4.0 (docs only) | BSL / BUSL |
| Unlicense | | Commons Clause |

**CI enforcement:** `go-licenses` (backend) + `license-checker` (frontend) run in CI. Prohibited licenses block merge.

### 24.5 Documentation Requirements

**Rule: Code changes are not complete until documentation is updated.**

| Change Type | Required Documentation Update |
|-------------|------------------------------|
| New API endpoint | OpenAPI spec + API docs |
| New feature | Feature README in `web/src/features/{feature}/README.md` |
| Schema change | Migration + ER diagram + Appendix A reference |
| New FSM | FSM Catalog (§8.11) |
| New shared component | Component catalog (§4.2) + barrel export |
| New alert | Runbook in `docs/runbooks/` |
| Architecture decision | ADR in `docs/adr/` |
| Configuration change | `values.yaml` annotation + env var docs |
| Breaking change | Changelog + migration guide + Sunset headers |

---

## Appendix A: Quick Reference — Where Does This Code Go?

| I need to… | Put it in… |
|------------|-----------|
| Define a business entity (Vehicle, Trip, ChargingSession) | `internal/domain/{entity}/` |
| Define validation rules for a domain entity | `internal/domain/{entity}/` |
| Define an FSM transition table for an entity | `internal/domain/{entity}/fsm.go` |
| Define a SubFSM for a nested state | `internal/domain/{entity}/sub_fsm.go` |
| Add the shared FSM engine, types, or SubFSM support | `internal/domain/fsm/` |
| Add FSM guards (transition preconditions) | `internal/domain/{entity}/guards.go` |
| Add FSM hooks (side effects on state change) | `internal/app/{service}/hooks.go` |
| Wire FSM engine + register SubFSMs + guards | `internal/app/{service}/` or `internal/domain/{entity}/fsm_setup.go` |
| Persist FSM transition history | `internal/adapter/postgres/fsm_history.go` |
| Display FSM state in the frontend | `web/src/lib/fsm.ts` (config) + `web/src/components/ui/StateBadge.tsx` |
| Orchestrate a use case (refresh vehicle, complete trip) | `internal/app/{service}/` |
| Define a repository interface | `internal/port/repository/` |
| Implement a Postgres query | `internal/adapter/postgres/` |
| Implement a Redis cache operation | `internal/adapter/redis/` |
| Call the Tesla Fleet API | `internal/adapter/tesla/` |
| Handle an HTTP request | `internal/handler/v1/` |
| Define a request/response DTO | `internal/handler/dto/` |
| Add HTTP middleware | `internal/handler/middleware/` |
| Add a shared HTTP utility (retry, circuit breaker) | `internal/platform/httputil/` |
| Add configuration | `internal/platform/config/` |
| Add a DB migration | `migrations/` |
| Create a UI primitive (Button, Input, Modal) | `web/src/components/ui/` |
| Create a layout component (PageContainer, Stack) | `web/src/components/layout/` |
| Create a feedback component (Spinner, EmptyState) | `web/src/components/feedback/` |
| Create a data display component (DataTable, StatCard) | `web/src/components/data-display/` |
| Create a chart wrapper (TimeSeriesChart, GaugeChart) | `web/src/components/charts/` |
| Create a map wrapper (MapContainer, MapRoute) | `web/src/components/maps/` |
| Create a form component (SearchInput, DateRangePicker) | `web/src/components/forms/` |
| Create an animation wrapper (AnimatedList, FadeIn) | `web/src/components/motion/` |
| Create a feature-specific component | `web/src/features/{feature}/components/` |
| Create a shared custom hook | `web/src/hooks/` |
| Create an API hook | `web/src/api/hooks/` |
| Create a shared utility function | `web/src/lib/` |
| Define a TypeScript type for API responses | `web/src/types/` |
| Add a translation | `web/src/i18n/locales/{lang}/{namespace}.json` |
| Add a Helm template | `deploy/helm/templates/` |
| Document an architecture decision | `docs/adr/` |

---

## Appendix B: Naming Conventions Summary

| Thing | Convention | Example |
|-------|-----------|---------|
| Go package | `lowercase`, single word preferred | `vehiclesvc`, `postgres`, `httputil` |
| Go interface | Verb-er or descriptive noun | `VehicleRepository`, `TeslaClient` |
| Go struct | Noun | `Vehicle`, `ChargingSession` |
| Go function | `PascalCase` (exported), `camelCase` (unexported) | `GetByID`, `parseVIN` |
| Go constant | `PascalCase` | `MaxRetries`, `DefaultTimeout` |
| Go error var | `Err` prefix | `ErrNotFound`, `ErrValidation` |
| DB table | `snake_case`, plural | `vehicles`, `charging_sessions` |
| DB column | `snake_case` | `display_name`, `created_at` |
| DB index | `idx_{table}_{columns}` | `idx_vehicles_user_id` |
| API endpoint | `/api/v1/{resource}` | `/api/v1/vehicles`, `/api/v1/trips` |
| React component | `PascalCase` | `VehicleCard`, `ChargingChart` |
| React hook | `use` prefix, `camelCase` | `useVehicles`, `useChargingSession` |
| TS type/interface | `PascalCase` | `Vehicle`, `CreateTripRequest` |
| TS utility | `camelCase` | `formatDistance`, `parseVIN` |
| CSS class | Tailwind utilities (no custom class names except component extractions) | — |
| Env variable | `SCREAMING_SNAKE_CASE` | `DATABASE_URL`, `TESLA_CLIENT_ID` |
| MQTT topic | `slash/separated/hierarchy` | `teslasync/vehicles/{vin}/state` |
| Redis key | `colon:separated:hierarchy` | `teslasync:vehicle:{id}:state` |
| Metric name | `teslasync_{subsystem}_{name}_{unit}` | `teslasync_http_request_duration_seconds` |
| FSM state constant | `State` prefix, `PascalCase` | `StateOnline`, `StateDriving`, `StateCharging` |
| FSM event constant | `Event` prefix, `PascalCase` | `EventWake`, `EventPlugIn`, `EventStartDrive` |
| SubFSM state constant | `SubState` prefix, parent-dotted string value | `SubStateRamping` → `"charging.ramping"` |
| SubFSM event constant | `SubEvent` prefix, `PascalCase` | `SubEventHandshakeOK`, `SubEventTaperStart` |
| FSM definition name | `snake_case` descriptive noun | `"vehicle_lifecycle"`, `"charging_session"`, `"export_job"` |
| FSM history table | `fsm_transitions` (single shared table) | — |
| FSM state DB column | `fsm_state` on aggregate table | `vehicles.fsm_state`, `charging_sessions.fsm_state` |
| SubFSM state DB column | `sub_fsm_state` (nullable) on aggregate table | `charging_sessions.sub_fsm_state` |

---

*Last updated: 2026-04-12*
*Maintainer: TeslaSync Engineering Team*
*Review cycle: Monthly, or when significant architectural changes are proposed*
