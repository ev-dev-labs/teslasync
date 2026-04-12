---
description: "Phase 4 — Application services: use cases, FSM wiring, hooks, transaction management"
---

# Phase 4: Application Services

**Branch:** `refactor/full-rewrite`
**Depends on:** Phase 3 (adapters implement port interfaces)

**Read ENGINEERING_GUIDELINES.md:** §3.2 (DI), §3.6 (Concurrency), §8.10 (FSM Integration in Services)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

### 1. `internal/app/vehiclesvc/`
- `service.go` — constructor accepts port interfaces only (VehicleRepository, VehicleCache, TeslaClient, FSMHistoryRepository). Methods: Create, GetByID, GetByUserID, Refresh, Delete.
- `state_transitions.go` — `HandleVehicleEvent(ctx, vehicleID, event)` per §8.10: BEGIN TX → load with FOR UPDATE → fsmEngine.Fire() → persist new state → record transition → COMMIT
- `fsm_setup.go` — create engine, register guards, register charging SubFSM, register hooks
- `hooks.go` — OnEnter/OnExit hooks (e.g., OnEnterCharging starts telemetry, OnExitCharging stops it)
- Unit tests with mocked port interfaces. ≥80% coverage.

### 2. `internal/app/chargingsvc/`
- `service.go` — CRUD + cost calculation
- `state_transitions.go` — parent FSM + SubFSM handling per §8.10
- `hooks.go` — OnEnterCompleted triggers cost calc + notification
- Unit tests ≥80%

### 3. `internal/app/tripsvc/`
- `service.go` — CRUD + geocoding integration
- `state_transitions.go`
- Unit tests ≥80%

### 4. `internal/app/exportsvc/`
- `service.go` — job creation, processing logic, storage upload
- `state_transitions.go`
- Unit tests ≥80%

### 5. `internal/app/notificationsvc/`
- `service.go` — sending logic, retry handling
- `state_transitions.go`
- Unit tests ≥80%

### 6. `internal/app/dashboardsvc/`
- `service.go` — aggregated stats (total miles, energy, cost, efficiency)
- Unit tests

## Acceptance Criteria

```bash
go build ./internal/app/...
go test ./internal/app/... -v -count=1 -cover
golangci-lint run ./internal/app/...
grep -rn "\.State\s*=" internal/app/  # must return nothing — no direct state assignment
```

- [ ] All services compile. Paste output.
- [ ] All tests pass with ≥80% coverage. Paste output.
- [ ] ALL state changes use `fsmEngine.Fire()` — grep above must find zero direct assignments
- [ ] All transitions recorded in `fsm_transitions` table within same transaction
- [ ] Services depend ONLY on port interfaces, never on adapters directly: `grep -rn "adapter/" internal/app/` returns nothing
- [ ] No SQL in services: `grep -rn "SELECT\|INSERT\|UPDATE" internal/app/` returns nothing
