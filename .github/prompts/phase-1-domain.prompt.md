---
description: "Phase 1 — Domain layer: entity types, FSM definitions, guards, validation for all aggregates"
---

# Phase 1: Domain Layer — Types, FSMs, Validation

**Branch:** `refactor/full-rewrite`
**Depends on:** Phase 0 must be complete (FSM engine exists in `internal/domain/fsm/`)

**Read ENGINEERING_GUIDELINES.md:** §2.2 (domain has zero adapter imports), §3.9 (Domain Validation), §8.3–8.6 (FSM definitions, guards), §8.11 (FSM Catalog), Appendix B (Naming)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

### 1. `internal/domain/vehicle/`
- `types.go` — Vehicle struct: ID, UserID, VIN, DisplayName, Model, Year, Color, FSMState, SubFSMState, OdometerMiles, CreatedAt, UpdatedAt, DeletedAt
- `validation.go` — `Validate()` with VIN checksum validation, year range (2012–current+1), Tesla model detection from VIN
- `fsm.go` — Vehicle lifecycle FSM:
  - States: `unknown`, `online`, `asleep`, `driving`, `charging`, `offline`
  - Events: `wake`, `sleep`, `start_drive`, `stop_drive`, `plug_in`, `unplug`, `go_offline`, `come_online`
  - Full transition table per §8.3
- `guards.go` — e.g. `CanStartDrive` (must be online), `CanPlugIn` (must be online or driving)
- `fsm_test.go` — ALL valid transitions + ALL key invalid transitions + guard tests

### 2. `internal/domain/charging/`
- `types.go` — ChargingSession: ID, VehicleID, ChargerType, StartBatteryLevel, EndBatteryLevel, EnergyAddedKWh, CostCents, FSMState, SubFSMState, StartedAt, CompletedAt
- `validation.go` — `Validate()`
- `fsm.go` — Charging session FSM: states `pending`, `connecting`, `charging`, `completing`, `completed`, `failed`
- `sub_fsm.go` — Charging phase SubFSM: states `starting`, `ramping`, `steady`, `tapering`, `complete` per §8.7
- `guards.go` — `CanStartCharging` (charger connected + battery < 100%), `CanComplete` (energy > 0)
- `fsm_test.go` — parent transitions + SubFSM full lifecycle + guard pass/reject

### 3. `internal/domain/trip/`
- `types.go` — Trip: ID, VehicleID, StartLat/Lon, EndLat/Lon, StartAddress, EndAddress, DistanceMiles, EnergyUsedKWh, EfficiencyWhPerMile, FSMState, StartedAt, CompletedAt
- `validation.go` — `Validate()`
- `fsm.go` — Trip FSM: states `started`, `in_progress`, `paused`, `completed`, `cancelled`
- `fsm_test.go` — all transitions

### 4. `internal/domain/export/`
- `types.go` — ExportJob: ID, UserID, Format (csv/json), VehicleID, DateFrom, DateTo, FSMState, FilePath, FileSize, CreatedAt, CompletedAt, FailedReason
- `fsm.go` — Export FSM: states `queued`, `validating`, `processing`, `uploading`, `completed`, `failed`
- `fsm_test.go` — all transitions

### 5. `internal/domain/notification/`
- `types.go` — Notification: ID, UserID, Type, Title, Body, FSMState, Channel, CreatedAt, SentAt, FailedReason, RetryCount
- `fsm.go` — Notification FSM: states `pending`, `sending`, `sent`, `failed`, `retrying`
- `fsm_test.go` — all transitions

### 6. `internal/domain/user/`
- `types.go` — User: ID, Email, DisplayName, AvatarURL, TeslaTokenEncrypted, TeslaRefreshTokenEncrypted, TokenExpiresAt, CreatedAt, UpdatedAt
- `validation.go` — `Validate()` (email format, display name length)

## Acceptance Criteria

```bash
go build ./internal/domain/...
go test ./internal/domain/... -v -count=1 -cover
go vet ./internal/domain/...
```

- [ ] All compile — zero errors. Paste output.
- [ ] All tests pass with ≥90% coverage. Paste output.
- [ ] **ZERO imports** from `internal/adapter/`, `internal/handler/`, or any external package (pgx, http, zerolog, etc.) in the domain layer. Verify: `grep -rn "pgx\|net/http\|zerolog\|redis" internal/domain/` must return nothing.
- [ ] Every FSM has tests for ALL valid transitions + key invalid transitions
- [ ] FSM Catalog in ENGINEERING_GUIDELINES.md §8.11 matches your implementations
