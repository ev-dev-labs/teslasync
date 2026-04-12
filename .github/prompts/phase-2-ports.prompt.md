---
description: "Phase 2 — Port interfaces: repository and external service interfaces for all aggregates"
---

# Phase 2: Port Interfaces

**Branch:** `refactor/full-rewrite`
**Depends on:** Phase 1 (domain types exist)

**Read ENGINEERING_GUIDELINES.md:** §3.1, §3.8 (Interface Segregation)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

### 1. `internal/port/repository/`
- `vehicle.go` — `VehicleRepository` (GetByID, GetByUserID, GetByVIN, Save, Delete, GetByIDForUpdate)
- `charging.go` — `ChargingSessionRepository` (GetByID, GetByVehicleID, ListByDateRange, Save, GetByIDForUpdate)
- `trip.go` — `TripRepository` (GetByID, GetByVehicleID, ListByDateRange, Save, GetByIDForUpdate)
- `export.go` — `ExportJobRepository` (GetByID, GetByUserID, Save, GetByIDForUpdate)
- `notification.go` — `NotificationRepository` (GetByID, GetByUserID, GetPending, Save, GetByIDForUpdate)
- `user.go` — `UserRepository` (GetByID, GetByEmail, Save, Delete)
- `fsm_history.go` — `FSMHistoryRepository` (RecordTransition, GetHistory, GetByEntityID)
- Every interface also has `WithTx(tx pgx.Tx) {InterfaceName}` for transaction support

### 2. `internal/port/external/`
- `tesla.go` — `TeslaClient` (GetVehicleState, GetVehicleData, WakeUp, SendCommand, RefreshToken, RevokeToken)
- `geocoding.go` — `GeocodingProvider` (ReverseGeocode(ctx, lat, lon) → Address, error) + `Name() string`
- `gasprices.go` — `GasPriceProvider` (GetCurrentPrice(ctx, region) → PricePerKWh, error)
- `storage.go` — `StorageProvider` (Upload(ctx, key, reader) → URL, error; GetSignedURL(ctx, key, expiry) → URL, error)

### 3. `internal/port/messaging/`
- `mqtt.go` — `MQTTPublisher` (Publish(ctx, topic, payload)), `MQTTSubscriber` (Subscribe(ctx, topic, handler))
- `notifier.go` — `Notifier` (SendPush(ctx, userID, notification), SendEmail(ctx, userID, notification))

## Acceptance Criteria

```bash
go build ./internal/port/...
go vet ./internal/port/...
grep -rn "pgx\|database/sql\|net/http\|go-redis\|paho" internal/port/
```

- [ ] All interfaces compile
- [ ] All interfaces use ONLY domain types — no pgx, http, driver, or adapter types. The grep above must return nothing except the `WithTx` method signature.
- [ ] Consumer-sized interfaces — no interface has more than 8 methods (§3.8)
- [ ] Every method accepts `context.Context` as first parameter
