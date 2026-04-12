---
description: "Phase 3 — Adapters: PostgreSQL repositories, Redis cache, Tesla client, MQTT, geocoding, migrations"
---

# Phase 3: Adapter Implementations

**Branch:** `refactor/full-rewrite`
**Depends on:** Phase 2 (port interfaces exist)

**Read ENGINEERING_GUIDELINES.md:** §3.5 (SQL/DB Access), §5 (Database), §8.9 (FSM Persistence), §9 (External APIs), §10 (Resilience)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

### 1. `internal/adapter/postgres/queries/`
- `vehicle.go` — ALL vehicle SQL as named constants (GetByID, GetByUserID, Upsert, Delete, GetByIDForUpdate)
- `charging.go` — ALL charging SQL
- `trip.go` — ALL trip SQL
- `export.go` — ALL export SQL
- `notification.go` — ALL notification SQL
- `user.go` — ALL user SQL
- `fsm_history.go` — INSERT transition, SELECT history

### 2. `internal/adapter/postgres/`
- `vehicle_repository.go` — implements `port/repository.VehicleRepository`
- `charging_repository.go` — implements ChargingSessionRepository
- `trip_repository.go` — implements TripRepository
- `export_repository.go` — implements ExportJobRepository
- `notification_repository.go` — implements NotificationRepository
- `user_repository.go` — implements UserRepository
- `fsm_history_repository.go` — implements FSMHistoryRepository
- Every repository: `WithTx()` method, `pgx.CollectRows` for scanning, wrapped errors with context
- Integration tests with testcontainers for EACH repository

### 3. `internal/adapter/redis/`
- `vehicle_cache.go` — cache-aside for vehicle state (TTL 30s) and location (TTL 15s)
- `session_cache.go` — cache for user sessions/preferences (TTL 5min)
- Key format: `teslasync:{entity}:{id}:{subresource}`

### 4. `internal/adapter/tesla/`
- `client.go` — HTTP client with OAuth token management, `rate.Limiter`, circuit breaker
- `mapper.go` — maps Tesla API JSON responses → domain types
- `context.WithTimeout(ctx, 10*time.Second)` on every call
- Metrics: `teslasync_tesla_api_calls_total`, `teslasync_tesla_api_duration_seconds`

### 5. `internal/adapter/geocoding/`
- `chain.go` — provider fallback chain (Google → Azure → Nominatim) per §9.3
- `google.go`, `azure.go`, `nominatim.go` — individual providers
- Redis cache for resolved addresses (TTL 24h)

### 6. `internal/adapter/gasprices/`
- `eia.go` — EIA API adapter

### 7. `internal/adapter/storage/`
- `s3.go` — S3/GCS/Azure Blob adapter (interface-driven, provider selected by config)

### 8. `internal/adapter/mqtt/`
- `publisher.go` — MQTT publish with QoS and tracing
- `subscriber.go` — MQTT subscribe with message routing
- `batcher.go` — 5-second signal batching window per §7.3

### 9. Database Migrations
- Review ALL existing migrations for: `timestamptz` (not `timestamp`), `IF NOT EXISTS`, `CONCURRENTLY` indexes
- Add migration: `fsm_transitions` table per §8.9
- Add migration: `fsm_state` and `sub_fsm_state` columns on all entity tables that need them
- Add migration: table partitioning for `fsm_transitions` per §5.8

## Acceptance Criteria

```bash
go build ./internal/adapter/...
go test ./internal/adapter/... -v -count=1 -tags=integration
golangci-lint run ./internal/adapter/...
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/app/ internal/handler/  # must return nothing
```

- [ ] All adapters compile and implement their port interfaces
- [ ] Integration tests pass with testcontainers. Paste output.
- [ ] ZERO SQL outside `internal/adapter/postgres/` — verify with grep above
- [ ] All SQL uses parameterized queries ($1, $2...) — no string concatenation
- [ ] Redis keys follow `teslasync:{entity}:{id}:{sub}` pattern
- [ ] All external calls have context timeout + retry + circuit breaker
- [ ] Tesla adapter has rate limiter + metrics
