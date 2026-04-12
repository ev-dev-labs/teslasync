---
description: "Phase 5 — HTTP handlers, DTOs, route registration, and cmd/ entry point wiring"
---

# Phase 5: HTTP Handlers & Wiring

**Branch:** `refactor/full-rewrite`
**Depends on:** Phase 4 (application services exist)

**Read ENGINEERING_GUIDELINES.md:** §6 (API Design), §3.2 (DI), §3.12 (Graceful Shutdown), §12 (Observability)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

### 1. `internal/handler/dto/`
- `vehicle.go` — CreateVehicleRequest, UpdateVehicleRequest, VehicleResponse. Validation tags. FromDomain()/ToDomain().
- `charging.go` — ChargingSessionResponse, ChargingTimelineResponse
- `trip.go` — TripResponse, TripDetailResponse
- `export.go` — CreateExportRequest, ExportJobResponse
- `dashboard.go` — DashboardStatsResponse
- `user.go` — UserResponse, UpdateUserRequest
- `response.go` — generic envelope: `DataResponse[T]`, `ListResponse[T]`, `ErrorResponse`. Pagination struct.
- `common.go` — shared `DecodeAndValidate[T]`, `Respond`, `RespondError`, `RespondList`

### 2. `internal/handler/v1/`
- `vehicle_handler.go` — GET /vehicles, GET /vehicles/{id}, POST /vehicles, PUT /vehicles/{id}, POST /vehicles/{id}/refresh, DELETE /vehicles/{id}. Each: decode → validate → delegate to service → respond.
- `charging_handler.go` — GET /charging-sessions, GET /charging-sessions/{id}, GET /charging-sessions/{id}/timeline
- `trip_handler.go` — GET /trips, GET /trips/{id}
- `export_handler.go` — POST /exports, GET /exports/{id}, GET /exports/{id}/download
- `dashboard_handler.go` — GET /dashboard/stats
- `user_handler.go` — GET /users/me, PUT /users/me
- Each handler: `Register(r chi.Router)` method
- Handler tests with `httptest` — test decoding, validation errors, success responses, error responses

### 3. `cmd/teslasync/main.go`
- Full dependency injection: config → pools → adapters → services → handlers → router
- Middleware chain: Recovery → SecurityHeaders → CORS → Logging → Metrics → Auth → RateLimit
- Route registration: `/api/v1/` prefix
- Health endpoints: `/healthz`, `/readyz`, `/healthz/deep`, `/version`
- Graceful shutdown per §3.12 (readiness → stop MQTT → drain HTTP → flush telemetry → close pools)
- Version log on startup

### 4. `cmd/notification-worker/main.go`
- Wire notification service + MQTT subscriber
- Health endpoints
- Graceful shutdown

### 5. `cmd/export-worker/main.go`
- Wire export service
- Health endpoints
- Graceful shutdown

## Acceptance Criteria

```bash
go build ./cmd/...
go test ./internal/handler/... -v -count=1
golangci-lint run ./...
grep -rn "SELECT\|INSERT\|UPDATE\|pool\.\|pgx\." internal/handler/  # must return nothing
```

- [ ] All three binaries build. Paste output.
- [ ] Handler tests pass. Paste output.
- [ ] Full lint clean. Paste output.
- [ ] API follows REST conventions per §6.1 (plural nouns, correct verbs, cursor pagination)
- [ ] Response envelope used consistently per §6.2
- [ ] All endpoints behind auth middleware (except /healthz, /version)
- [ ] ZERO business logic or SQL in handlers — verify with grep above
- [ ] Graceful shutdown handles: readiness flip → MQTT unsub → HTTP drain → telemetry flush → pool close
