# TeslaSync Refactoring — Agent Prompts

> ## Branching Strategy
>
> **ALL refactoring work happens on a single long-lived branch: `refactor/full-rewrite`.**
> Nothing merges to `main` until the entire refactoring is complete and verified.
>
> ```
> main ─────────────────────────────────────── (untouched until fully done)
>   │
>   └── refactor/full-rewrite ──────────────── (ALL phases land here)
>         ├── Phase 0 PR → merge to refactor/full-rewrite
>         ├── Phase 1 PR → merge to refactor/full-rewrite
>         ├── Phase 2 PR → merge to refactor/full-rewrite
>         ├── ...
>         └── Phase 8 PR → merge to refactor/full-rewrite
>                            │
>                            └── FINAL: One big PR from refactor/full-rewrite → main
>                                (only after ALL phases pass, full test suite green)
> ```
>
> ### Setup (do this once before starting)
> ```bash
> git checkout main
> git pull
> git checkout -b refactor/full-rewrite
> git push -u origin refactor/full-rewrite
> ```
>
> ### For each phase issue
> - Set the **base branch** to `refactor/full-rewrite` (not `main`)
> - The Copilot agent will create a feature branch off `refactor/full-rewrite`
> - Review the PR → merge into `refactor/full-rewrite`
> - Start the next phase
>
> ### When all phases are done
> - Run the FULL test suite on `refactor/full-rewrite`
> - Create one final PR: `refactor/full-rewrite` → `main`
> - Full team review of the final PR
> - Merge to `main` only when everything is verified
>
> ### How to create issues for Copilot Cloud Agent
> In each issue body, add this line at the top so the agent targets the right branch:
> ```
> Base branch: refactor/full-rewrite
> ```

---

> **Workflow:** Create these as GitHub Issues, one at a time, in order.
> Assign each to the Copilot Cloud Agent. Wait for it to complete and merge
> into `refactor/full-rewrite` before starting the next one.
>
> **DO NOT create all issues at once.** The agent must finish Phase 0 before
> starting Phase 1, because each phase depends on the previous one's output.

---

## Phase 0: Foundation — Shared Infrastructure

### Issue Title: `refactor: establish foundation packages (config, errors, FSM engine, platform)`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Set up the foundational packages that ALL other code will depend on.
Nothing else can be refactored until these exist.

## MANDATORY: Read before starting

Read `ENGINEERING_GUIDELINES.md` sections:
- §2 (Repository & Project Structure)
- §3.7 (Configuration)
- §3.3 (Error Handling)
- §3.8 (Interface Segregation)
- §3.11 (Build Metadata)
- §8.2–8.8 (FSM Engine)

Follow `.github/copilot-instructions.md` PHASES 1–5 exactly. No shortcuts.

## Tasks

### 1. Create `internal/platform/config/`
- [ ] `config.go` — single `Config` struct with all sub-configs (Server, Database, Redis, Tesla, MQTT, Auth, Features)
- [ ] Uses `env` tags for environment variable binding
- [ ] `MustLoad()` function that parses + validates
- [ ] `features.go` — `FeatureFlags` struct
- [ ] Unit tests for validation logic

### 2. Create `internal/domain/errors.go`
- [ ] Domain error sentinels: `ErrNotFound`, `ErrConflict`, `ErrUnauthorized`, `ErrForbidden`, `ErrValidation`, `ErrRateLimited`, `ErrExternalAPI`
- [ ] `ValidationError` and `ValidationErrors` types
- [ ] Unit tests

### 3. Create `internal/domain/fsm/`
- [ ] `types.go` — `State`, `Event`, `Guard[T]`, `Action[T]`, `Transition`, `HookType`
- [ ] `definition.go` — `Definition` struct with builder pattern (`NewDefinition().Transition().Build()`)
- [ ] `engine.go` — `Engine[T]` with `Fire()`, guard evaluation, hook execution, OpenTelemetry spans
- [ ] `sub_fsm.go` — `SubFSMConfig`, `SubFSMInstance`, `RegisterSubFSM()`, `FireSub()`
- [ ] `errors.go` — `ErrInvalidTransition`, `ErrGuardRejected`, `ErrNoSubFSM`, `ErrSubFSMInactive`
- [ ] Comprehensive tests: valid transitions, invalid transitions, guards, hooks, SubFSM lifecycle

### 4. Create `internal/platform/database/`
- [ ] `connect.go` — `MustConnect()` using pgx pool config from §5.1
- [ ] Migration runner using golang-migrate

### 5. Create `internal/platform/cache/`
- [ ] `connect.go` — Redis `MustConnect()`
- [ ] Generic cache helpers (Get/Set with TTL)

### 6. Create `internal/platform/telemetry/`
- [ ] OpenTelemetry tracer provider setup
- [ ] Prometheus registry setup
- [ ] Zerolog global logger setup

### 7. Create `internal/platform/httputil/`
- [ ] Retry with exponential backoff + jitter
- [ ] Circuit breaker
- [ ] `DecodeAndValidate[T]` generic helper
- [ ] `Respond()` and `RespondError()` helpers using response envelope from §6.2

### 8. Create `internal/platform/buildinfo/`
- [ ] Version, Commit, BuildDate variables (set via ldflags)
- [ ] `/version` handler

### 9. Create `internal/handler/middleware/`
- [ ] `error_mapper.go` — maps domain errors → HTTP status codes (§3.3)
- [ ] `auth.go` — JWT/JWKS validation middleware
- [ ] `logging.go` — request/response structured logging
- [ ] `metrics.go` — Prometheus RED metrics
- [ ] `recovery.go` — panic recovery
- [ ] `cors.go` — CORS policy from §13.8
- [ ] `security_headers.go` — security headers from §13.9
- [ ] `idempotency.go` — idempotency key middleware from §6.5
- [ ] `ratelimit.go` — rate limiting middleware from §6.4

## Acceptance Criteria

- [ ] All packages compile: `go build ./...`
- [ ] All tests pass: `go test ./internal/platform/... ./internal/domain/...`
- [ ] golangci-lint clean: `golangci-lint run ./...`
- [ ] FSM engine has ≥90% test coverage
- [ ] No `os.Getenv()` outside `internal/platform/config/`
- [ ] No global mutable state
- [ ] Every function doing I/O accepts `context.Context`
```

---

## Phase 1: Domain Layer — Types, FSMs, Validation

### Issue Title: `refactor: define domain aggregates, FSM definitions, and validation rules`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Define ALL domain types, FSM state machines, guards, and validation rules.
Domain layer has ZERO external dependencies — no pgx, no HTTP, no logging imports.

## MANDATORY: Read before starting

Read `ENGINEERING_GUIDELINES.md` sections:
- §2.2 (Structural Rules — domain has zero adapter imports)
- §3.9 (Domain Validation)
- §8.3–8.6 (FSM Definition, Guards)
- §8.11 (FSM Catalog)
- Appendix B (Naming Conventions)

## Depends On

Phase 0 must be complete (FSM engine in `internal/domain/fsm/` exists).

## Tasks

### 1. `internal/domain/vehicle/`
- [ ] `types.go` — Vehicle struct (ID, UserID, VIN, DisplayName, FSMState, SubFSMState, CreatedAt, UpdatedAt, DeletedAt)
- [ ] `validation.go` — `Validate()` method, VIN validation, Tesla model detection
- [ ] `fsm.go` — Vehicle lifecycle FSM (states: unknown, online, asleep, driving, charging, offline) with all transitions per §8.3
- [ ] `guards.go` — guards (e.g., CanStartDrive requires online state)
- [ ] `fsm_test.go` — all valid transitions, all key invalid transitions

### 2. `internal/domain/charging/`
- [ ] `types.go` — ChargingSession struct (ID, VehicleID, StartBatteryLevel, EndBatteryLevel, EnergyAdded, Cost, FSMState, SubFSMState, StartedAt, CompletedAt)
- [ ] `validation.go` — `Validate()` method
- [ ] `fsm.go` — Charging session FSM (states: pending, connecting, charging, completing, completed, failed)
- [ ] `sub_fsm.go` — Charging phase SubFSM (states: starting, ramping, steady, tapering, complete) per §8.7
- [ ] `guards.go` — CanStartCharging, CanCompleteCharging
- [ ] `fsm_test.go` — full transition + SubFSM lifecycle tests

### 3. `internal/domain/trip/`
- [ ] `types.go` — Trip struct (ID, VehicleID, StartLocation, EndLocation, Distance, Efficiency, FSMState, StartedAt, CompletedAt)
- [ ] `validation.go` — `Validate()` method
- [ ] `fsm.go` — Trip lifecycle FSM (states: started, in_progress, paused, completed, cancelled)
- [ ] `fsm_test.go` — all transitions

### 4. `internal/domain/export/`
- [ ] `types.go` — ExportJob struct (ID, UserID, Format, DateRange, FSMState, FilePath, CreatedAt, CompletedAt)
- [ ] `fsm.go` — Export job FSM (states: queued, validating, processing, uploading, completed, failed)
- [ ] `fsm_test.go` — all transitions

### 5. `internal/domain/notification/`
- [ ] `types.go` — Notification struct (ID, UserID, Type, Title, Body, FSMState, CreatedAt, SentAt)
- [ ] `fsm.go` — Notification FSM (states: pending, sending, sent, failed, retrying)
- [ ] `fsm_test.go` — all transitions

### 6. `internal/domain/user/`
- [ ] `types.go` — User struct (ID, Email, DisplayName, TeslaTokenEncrypted, CreatedAt)
- [ ] `validation.go` — `Validate()` method

## Acceptance Criteria

- [ ] `go build ./internal/domain/...` — zero errors
- [ ] `go test ./internal/domain/...` — all pass, ≥90% coverage
- [ ] `go vet ./internal/domain/...` — clean
- [ ] ZERO imports from `internal/adapter/`, `internal/handler/`, or any external package in domain layer
- [ ] Every FSM has tests for ALL valid + key invalid transitions
- [ ] FSM Catalog in ENGINEERING_GUIDELINES.md §8.11 matches implementations
```

---

## Phase 2: Port Interfaces

### Issue Title: `refactor: define port interfaces for all repositories and external services`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Define ALL interfaces that adapters will implement. These go in `internal/port/`.
Only interfaces and domain type imports — no implementations.

## MANDATORY: Read `ENGINEERING_GUIDELINES.md` §3.1, §3.8

## Depends On: Phase 1

## Tasks

### 1. `internal/port/repository/`
- [ ] `vehicle.go` — VehicleRepository (GetByID, GetByUserID, GetByVIN, Save, Delete, GetByIDForUpdate)
- [ ] `charging.go` — ChargingSessionRepository
- [ ] `trip.go` — TripRepository
- [ ] `export.go` — ExportJobRepository
- [ ] `notification.go` — NotificationRepository
- [ ] `user.go` — UserRepository
- [ ] `fsm_history.go` — FSMHistoryRepository (RecordTransition, GetHistory)

### 2. `internal/port/external/`
- [ ] `tesla.go` — TeslaClient (GetVehicleState, SendCommand, RefreshToken)
- [ ] `geocoding.go` — GeocodingProvider (ReverseGeocode)
- [ ] `gasprices.go` — GasPriceProvider (GetCurrentPrice)
- [ ] `storage.go` — StorageProvider (Upload, GetURL)

### 3. `internal/port/messaging/`
- [ ] `mqtt.go` — MQTTPublisher (Publish), MQTTSubscriber (Subscribe)
- [ ] `notifier.go` — Notifier (Send)

## Acceptance Criteria

- [ ] All interfaces compile
- [ ] All interfaces use ONLY domain types (no pgx, no http, no driver types)
- [ ] Consumer-sized interfaces (not fat interfaces — §3.8)
```

---

## Phase 3: Adapter Implementations

### Issue Title: `refactor: implement PostgreSQL repositories, Redis cache, and external API adapters`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Implement all port interfaces with concrete adapters.

## MANDATORY: Read `ENGINEERING_GUIDELINES.md` §3.5 (SQL), §5 (Database), §9 (External APIs)

## Depends On: Phase 2

## Tasks

### 1. `internal/adapter/postgres/`
- [ ] `queries/` subfolder — ALL SQL as named constants (§3.5)
- [ ] `vehicle_repository.go` — implements port/repository.VehicleRepository
- [ ] `charging_repository.go`
- [ ] `trip_repository.go`
- [ ] `export_repository.go`
- [ ] `notification_repository.go`
- [ ] `user_repository.go`
- [ ] `fsm_history_repository.go`
- [ ] WithTx() method on each repository for transaction support
- [ ] Integration tests with testcontainers for each repository

### 2. `internal/adapter/redis/`
- [ ] `vehicle_cache.go` — cache-aside pattern, TTLs per §5.2
- [ ] `session_cache.go`

### 3. `internal/adapter/tesla/`
- [ ] `client.go` — OAuth token management, rate limiter, circuit breaker
- [ ] Maps Tesla API responses to domain types (adapter responsibility)
- [ ] `context.WithTimeout` on every call

### 4. `internal/adapter/geocoding/`
- [ ] `chain.go` — fallback chain (Google → Azure → Nominatim) per §9.3
- [ ] Cache resolved addresses in Redis

### 5. `internal/adapter/mqtt/`
- [ ] `publisher.go`, `subscriber.go`
- [ ] `batcher.go` — 5-second signal batching per §7.3

### 6. DB Migrations
- [ ] Review and fix all 44 existing migrations for:
  - `timestamptz` (not `timestamp`)
  - `IF NOT EXISTS` guards
  - `CONCURRENTLY` for index creation
- [ ] Add `fsm_state` columns where missing
- [ ] Add `fsm_transitions` table per §8.9

## Acceptance Criteria

- [ ] All adapters compile and implement their port interfaces
- [ ] Integration tests pass with testcontainers
- [ ] Zero SQL outside `internal/adapter/postgres/`
- [ ] All SQL uses parameterized queries ($1, $2...)
- [ ] Redis keys follow `teslasync:{entity}:{id}:{subresource}` pattern
- [ ] All external calls have timeouts, retries, circuit breakers
```

---

## Phase 4: Application Services

### Issue Title: `refactor: implement application services with FSM integration and hooks`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Implement use-case orchestration in `internal/app/`. Services depend on port
interfaces (not adapters). All state changes go through the FSM engine.

## MANDATORY: Read `ENGINEERING_GUIDELINES.md` §8.10 (FSM Integration), §3.2 (DI)

## Depends On: Phase 3

## Tasks

### 1. `internal/app/vehiclesvc/`
- [ ] `service.go` — constructor injection, depends on port interfaces
- [ ] `state_transitions.go` — `HandleVehicleEvent()` per §8.10 (TX + FOR UPDATE + Fire + persist + history)
- [ ] `hooks.go` — OnEnter/OnExit hooks for vehicle states
- [ ] Unit tests with mocked port interfaces

### 2. `internal/app/chargingsvc/`
- [ ] `service.go`
- [ ] `state_transitions.go` — parent FSM + SubFSM support per §8.10
- [ ] `hooks.go` — telemetry capture, cost calculation, notifications
- [ ] Unit tests

### 3. `internal/app/tripsvc/`
- [ ] `service.go`
- [ ] `state_transitions.go`
- [ ] Unit tests

### 4. `internal/app/exportsvc/`
- [ ] `service.go`
- [ ] Unit tests

### 5. `internal/app/notificationsvc/`
- [ ] `service.go`
- [ ] Unit tests

## Acceptance Criteria

- [ ] All services compile
- [ ] All state changes use `fsmEngine.Fire()` inside transactions
- [ ] All transitions are recorded in `fsm_transitions`
- [ ] No direct `entity.State = "x"` assignments anywhere
- [ ] Unit tests ≥80% coverage with mocked interfaces
- [ ] Services do NOT import from `internal/adapter/` (only port interfaces)
```

---

## Phase 5: HTTP Handlers & Wiring

### Issue Title: `refactor: implement HTTP handlers, DTOs, and wire everything in cmd/`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Build the HTTP layer and wire all dependencies in the entry points.

## MANDATORY: Read `ENGINEERING_GUIDELINES.md` §6 (API Design), §3.2 (DI)

## Depends On: Phase 4

## Tasks

### 1. `internal/handler/dto/`
- [ ] Request/response types for each entity with validation tags
- [ ] `FromDomain()` / `ToDomain()` conversion functions
- [ ] Response envelope (§6.2)

### 2. `internal/handler/v1/`
- [ ] `vehicle_handler.go` — CRUD + refresh + state endpoints
- [ ] `charging_handler.go` — session CRUD + timeline
- [ ] `trip_handler.go` — CRUD + route data
- [ ] `export_handler.go` — create + status + download
- [ ] `dashboard_handler.go` — aggregated stats
- [ ] Each handler has `Register(r chi.Router)` method
- [ ] Handlers: decode → validate → delegate → respond (NO business logic)

### 3. `cmd/teslasync/main.go`
- [ ] Full dependency injection wiring
- [ ] Graceful shutdown per §3.12
- [ ] Version logging on startup

### 4. `cmd/notification-worker/main.go`
- [ ] Wire notification service
- [ ] Graceful shutdown

### 5. `cmd/export-worker/main.go`
- [ ] Wire export service
- [ ] Graceful shutdown

### 6. Handler tests with httptest

## Acceptance Criteria

- [ ] All three binaries build: `go build ./cmd/...`
- [ ] All tests pass
- [ ] API follows REST conventions (§6.1)
- [ ] Response envelope used consistently (§6.2)
- [ ] All endpoints have auth middleware
- [ ] Zero business logic in handlers
```

---

## Phase 6: Frontend Shared Component Library

### Issue Title: `refactor: build shared React component library`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Build the complete shared component library per §4.2 BEFORE any feature code.
Every component must be reusable, accessible, and dark-mode compatible.

## MANDATORY: Read `ENGINEERING_GUIDELINES.md` §4.1–4.7 (entire frontend section)

## Tasks

Build EVERY component from the §4.2 catalog:

### 1. `web/src/components/ui/` — All 16 primitives
### 2. `web/src/components/layout/` — All 8 layout components (including PageContainer)
### 3. `web/src/components/feedback/` — All 8 feedback components
### 4. `web/src/components/data-display/` — DataTable, StatCard, KVList, Timeline, Metric
### 5. `web/src/components/charts/` — ChartContainer, TimeSeriesChart, BarChart, GaugeChart
### 6. `web/src/components/maps/` — MapContainer, MapMarker, MapRoute
### 7. `web/src/components/forms/` — FormField, SearchInput, DateRangePicker
### 8. `web/src/components/motion/` — AnimatedList, FadeIn, SlideIn, Collapse
### 9. `web/src/hooks/` — all shared hooks from §4.4
### 10. `web/src/lib/utils.ts` — cn() utility
### 11. `web/src/lib/fsm.ts` — FSM state display config from §8.13
### 12. `web/src/api/client.ts` — single API client from §4.8
### 13. Barrel exports (`index.ts`) for every category

## Acceptance Criteria

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run lint` — clean
- [ ] `npm run test` — all component tests pass
- [ ] Every component: forwardRef, className via cn(), dark mode, a11y
- [ ] Barrel exports for every category
- [ ] ZERO business logic in shared components
- [ ] NO feature-specific imports in shared components
```

---

## Phase 7: Frontend Features

### Issue Title: `refactor: build feature pages using ONLY shared components`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Build all feature pages by COMPOSING shared components from Phase 6.
NO raw HTML. NO direct Recharts/Leaflet/Framer imports.

## MANDATORY: Read `ENGINEERING_GUIDELINES.md` §4.1 (reusability mandate), §4.5 (decision tree)

## Depends On: Phase 6

## Tasks

### 1. `web/src/api/hooks/` — TanStack Query hooks for every entity
### 2. `web/src/types/` — TypeScript types matching API response shapes
### 3. `web/src/features/dashboard/` — DashboardPage with StatCards, charts
### 4. `web/src/features/vehicles/` — List, Detail, State pages
### 5. `web/src/features/charging/` — Session list, detail, chart
### 6. `web/src/features/trips/` — Trip list, detail, map view
### 7. `web/src/features/settings/` — Settings page
### 8. `web/src/features/maps/` — Full map view with vehicle locations
### 9. `web/src/routes/` — React.lazy route definitions with code splitting
### 10. `web/src/i18n/` — translation files for all features

## Acceptance Criteria

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run test` — all tests pass
- [ ] `npm run build` — succeeds, JS bundle < 200 KB gzipped
- [ ] ZERO `fetch()` or `useEffect` for data — only TanStack Query hooks
- [ ] ZERO `<button>`, `<input>`, `<table>` in feature code — only shared components
- [ ] ZERO `any` types
- [ ] ZERO hardcoded strings — all through i18next
- [ ] Every page handles: loading, error, empty states via PageContainer
```

---

## Phase 8: Cleanup, Tests & Observability

### Issue Title: `refactor: final cleanup — delete dead code, fill test gaps, add dashboards`

### Issue Body:

```markdown
**Base branch: `refactor/full-rewrite`**

## Objective

Final cleanup pass. Delete old duplicated code. Fill test coverage gaps.
Add Grafana dashboards and runbooks.

## Tasks

### 1. Dead code removal
- [ ] Find and delete all orphan files (not imported anywhere)
- [ ] Delete all code that was replaced by the new architecture
- [ ] Remove old scattered SQL, ad-hoc state changes, duplicate components

### 2. Test coverage
- [ ] Domain: ≥90%
- [ ] Services: ≥80%
- [ ] Adapters: ≥70%
- [ ] Handlers: ≥70%
- [ ] React components: ≥70%

### 3. Observability
- [ ] Grafana dashboard for RED metrics
- [ ] Grafana dashboard for FSM transitions
- [ ] Grafana dashboard for Tesla API health
- [ ] Runbooks in docs/runbooks/ for each alert

### 4. Documentation
- [ ] Update README.md
- [ ] Verify FSM Catalog (§8.11) is complete and accurate
- [ ] Verify OpenAPI spec matches handlers

## Acceptance Criteria

- [ ] Zero dead code
- [ ] All coverage targets met
- [ ] Full CI passes (lint + test + build + security)
- [ ] No golangci-lint warnings
- [ ] No ESLint warnings
- [ ] No TypeScript errors
```

---

## Tips for Running These

1. **One issue at a time.** Wait for merge before creating the next.
2. **Review the PR carefully.** Check for patchwork (the agent's instructions tell it not to, but verify).
3. **If the agent does patchwork**, comment on the PR: "This violates §X.Y of ENGINEERING_GUIDELINES.md. Implement properly." The agent will read the comment and fix it.
4. **If the agent claims done but isn't**, comment: "Run `go test ./...` and paste the output. List every planned item with ✅/❌ status."
5. **Phase 0 is the most critical.** If the foundation is wrong, everything built on it will be wrong. Review Phase 0 very carefully.
