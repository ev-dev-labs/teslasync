---
description: "Phase 0 — Foundation packages: config, errors, FSM engine, middleware, platform utilities"
---

# Phase 0: Foundation — Shared Infrastructure

**Branch:** `refactor/full-rewrite`

**Read these ENGINEERING_GUIDELINES.md sections before starting:**
- §2 (Repository & Project Structure)
- §3.3 (Error Handling), §3.7 (Configuration), §3.8 (Interface Segregation), §3.11 (Build Metadata), §3.12 (Graceful Shutdown)
- §8.2–8.8 (FSM Engine, Guards, Hooks, SubFSMs)
- §6.2 (Response Envelope), §6.4 (Rate Limiting), §6.5 (Idempotency)
- §13.8 (CORS), §13.9 (Security Headers)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly. No shortcuts. No patchwork.**

## What to Build

### 1. `internal/platform/config/`
- `config.go` — single `Config` struct with all sub-configs (Server, Database, Redis, Tesla, MQTT, Auth, Features)
- Uses `env` tags for environment variable binding
- `MustLoad()` function that parses + validates, fails fast on invalid config
- `features.go` — `FeatureFlags` struct
- Unit tests for validation logic

### 2. `internal/domain/errors.go`
- Domain error sentinels: `ErrNotFound`, `ErrConflict`, `ErrUnauthorized`, `ErrForbidden`, `ErrValidation`, `ErrRateLimited`, `ErrExternalAPI`
- `ValidationError` and `ValidationErrors` types with `Error()` method
- Unit tests

### 3. `internal/domain/fsm/` — the FSM engine
- `types.go` — `State`, `Event`, `Guard[T]`, `Action[T]`, `Transition`, `HookType`
- `definition.go` — `Definition` struct with builder: `NewDefinition("name").InitialState(s).Transition(from, event, to).Build()`
- `engine.go` — `Engine[T]` with `Fire()` that: validates transition → evaluates guards → fires OnExit → fires BeforeTransition → changes state → fires AfterTransition → fires OnEnter. Include OpenTelemetry spans.
- `sub_fsm.go` — `SubFSMConfig`, `SubFSMInstance`, `RegisterSubFSM()`, `FireSub()` per §8.7–8.8
- `errors.go` — `ErrInvalidTransition`, `ErrGuardRejected`, `ErrNoSubFSM`, `ErrSubFSMInactive`
- **Comprehensive tests:** all valid transitions, invalid transitions, guard pass/reject, hook execution order, SubFSM activation/deactivation/terminal-state-bubbling

### 4. `internal/platform/database/`
- `connect.go` — `MustConnect()` using pgx pool config (MaxConns=20, MinConns=5, timeouts per §5.1)
- `migrate.go` — migration runner using golang-migrate

### 5. `internal/platform/cache/`
- `connect.go` — Redis `MustConnect()` from config
- Generic cache helpers: `Get[T]`, `Set[T]` with mandatory TTL, `Delete`

### 6. `internal/platform/telemetry/`
- `tracer.go` — OpenTelemetry tracer provider setup
- `metrics.go` — Prometheus registry setup
- `logger.go` — zerolog global logger setup with JSON output

### 7. `internal/platform/httputil/`
- `retry.go` — exponential backoff with jitter (§10.1)
- `circuit_breaker.go` — three-state circuit breaker (§10.2)
- `request.go` — `DecodeAndValidate[T]` generic helper
- `response.go` — `Respond()` and `RespondError()` using response envelope from §6.2

### 8. `internal/platform/buildinfo/`
- `buildinfo.go` — Version, Commit, BuildDate variables (set via ldflags)
- `handler.go` — `GET /version` endpoint

### 9. `internal/handler/middleware/`
- `error_mapper.go` — maps domain errors → HTTP status codes per §3.3
- `auth.go` — JWT/JWKS validation, extracts user to context
- `logging.go` — request/response structured logging with trace_id, method, path, status, duration_ms
- `metrics.go` — Prometheus RED metrics (teslasync_http_requests_total, teslasync_http_request_duration_seconds)
- `recovery.go` — panic recovery with structured error logging
- `cors.go` — CORS policy per §13.8 (explicit origins, never wildcard)
- `security_headers.go` — HSTS, CSP, X-Content-Type-Options, etc. per §13.9
- `idempotency.go` — idempotency key middleware per §6.5
- `ratelimit.go` — Redis sliding-window rate limiter per §6.4

## Acceptance Criteria — ALL must pass before claiming done

```bash
# Run these and paste output in your completion report
go build ./internal/platform/... ./internal/domain/... ./internal/handler/middleware/...
go test ./internal/platform/... ./internal/domain/... ./internal/handler/middleware/... -v -count=1
golangci-lint run ./internal/platform/... ./internal/domain/... ./internal/handler/middleware/...
```

- [ ] All packages compile with zero errors
- [ ] All tests pass — paste output
- [ ] golangci-lint clean — paste output
- [ ] FSM engine has ≥90% test coverage
- [ ] No `os.Getenv()` outside `internal/platform/config/`
- [ ] No global mutable state
- [ ] Every function doing I/O accepts `context.Context` as first param
- [ ] Every error is wrapped with context: `fmt.Errorf("doing X: %w", err)`
