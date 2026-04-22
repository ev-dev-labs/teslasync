# 04 — Update Telemetry Write Path (Hot/Cold Split)

**Phase:** 5
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`
**Pre-req:** Prompt 03 complete (repos exist), migration 000142 applied
**Estimated effort:** 2 days

---

## Goal

Refactor `internal/api/telemetry_handler.go` to implement the hot/cold split from ADR-002:
- Known hot signals → typed columns on the matching snapshot table
- Compound signals (DoorState, WindowState, TimeOfDay, Location) → flattened to typed columns first, then routed to hot path
- Everything else → `signal_observations`
- Every signal name (hot or cold) is upserted into `signal_catalog`

Eliminate all `signals jsonb` writes.

## Current state (reference)

`telemetry_handler.go:1492-1545` currently:
1. Receives a Fleet Telemetry batch (vehicle_id, timestamp, list of signal name/value pairs)
2. Calls `normalizeFleetUnits()` to convert units and flatten compound types into a `map[string]any`
3. Writes that map to the `signals jsonb` column on the appropriate snapshot table
4. Also writes individual hot signals to typed columns when `signal_types.go` recognizes them

The dual-write is what we're removing. The new path is single-write per signal: hot OR cold, never both.

## Design

### Hot signal catalog (in-memory, built at startup)

```go
// internal/telemetry/hot_signals.go

type HotSignal struct {
    Name        string
    Table       string  // "positions", "charging_telemetry", etc.
    Column      string  // typed column name on that table
    Kind        string  // "numeric", "text", "bool"
    Transformer func(raw any) (any, error)  // optional unit conversion
}

var HotSignalCatalog = map[string]HotSignal{
    "VehicleSpeed":     {"VehicleSpeed", "positions", "speed_mps", "numeric", convertMphToMps},
    "Location":         {"Location", "positions", "", "compound_location", nil},  // expanded by Flatten()
    "DoorState":        {"DoorState", "security_events", "", "compound_doors", nil},
    "ChargeState":      {"ChargeState", "charging_telemetry", "charge_state", "text", nil},
    // ... ~50 entries derived from Phase 3 hot signal selection
}
```

Source the list from the schema files (`schema/03-telemetry-hot.sql`'s hot signal selection methodology).

### Compound signal flattening

Compound signals expand to multiple atomic writes. Example for `DoorState`:

```go
// raw input from Tesla:  {"DriverFront": "Open", "PassengerRear": "Closed", ...}
// expands to multiple HotSignal writes against security_events:
//   door_driver_front_open := true
//   door_passenger_rear_open := false
//   ... etc.
```

Implement compound expanders:
- `expandDoorState(raw map[string]any) map[string]any` → flat map of `door_*_open` booleans
- `expandWindowState(raw map[string]any) map[string]any` → flat map of `window_*_open` booleans
- `expandTimeOfDay(raw map[string]any) string` → "HH:MM:SS"
- `expandLocation(raw map[string]any) (lat, lon, elevation float64)` → 3 writes to positions table

These live in `internal/telemetry/compound.go` with unit tests covering Tesla's actual payload shapes (use samples from `tests/fixtures/`).

### Write path (new)

```go
func (h *TelemetryHandler) ingestBatch(ctx context.Context, vehicleID int64, batch []FleetSignal) error {
    // 1. Normalize units and timestamps
    normalized := h.normalize(batch)

    // 2. Bucket by destination
    var (
        positionsRow         *PositionsRow
        chargingRow          *ChargingTelemetryRow
        climateRow           *ClimateSnapshotRow
        motorRow             *MotorSnapshotRow
        securityRow          *SecurityEventRow
        metaRow              *VehicleMetaSnapshotRow
        coldObservations     []SignalObservation
        signalNamesSeen      []string
    )

    for _, sig := range normalized {
        signalNamesSeen = append(signalNamesSeen, sig.Name)

        // Compound signals expand into multiple typed writes
        if expander, ok := compoundExpanders[sig.Name]; ok {
            expander(sig, &positionsRow, &securityRow /* etc. */)
            continue
        }

        // Lookup hot catalog
        if hot, ok := HotSignalCatalog[sig.Name]; ok {
            applyToTypedRow(hot, sig, &positionsRow, &chargingRow, /* etc. */)
            continue
        }

        // Cold path
        coldObservations = append(coldObservations, SignalObservation{
            VehicleID: vehicleID, Ts: sig.Ts, SignalName: sig.Name,
            ValueNumeric: sig.AsNumeric(), ValueText: sig.AsText(), ValueBool: sig.AsBool(),
            Source: "fleet_telemetry",
        })
    }

    // 3. Persist (single transaction)
    return h.db.WithTx(ctx, func(tx pgx.Tx) error {
        if positionsRow != nil { if err := h.positionsRepo.UpsertTx(ctx, tx, positionsRow); err != nil { return err } }
        if chargingRow != nil  { /* ... */ }
        if climateRow != nil   { /* ... */ }
        if motorRow != nil     { /* ... */ }
        if securityRow != nil  { /* ... */ }
        if metaRow != nil      { /* ... */ }
        if len(coldObservations) > 0 {
            if err := h.signalObsRepo.BulkInsertTx(ctx, tx, coldObservations); err != nil { return err }
        }
        // 4. Update signal_catalog (last_seen, count)
        return h.signalCatalogRepo.BulkUpsertTx(ctx, tx, signalNamesSeen)
    })
}
```

### What goes away

- `signals jsonb` writes — gone
- `normalizeFleetUnits` returning a `map[string]any` for jsonb storage — gone (returns typed `[]NormalizedSignal` instead)
- Any code that does `json.Marshal` of signal payloads for DB writes — gone

## Tests

- Unit test each compound expander with real Tesla payload fixtures
- Unit test `HotSignalCatalog` lookups for ~10 canonical signals
- Integration test (with testcontainers TS instance): ingest a 100-signal batch, verify rows land in correct tables, no signals dropped, `signal_observations` count = (total signals) - (hot signals) - (compound signal expansions)
- Property test: any signal name not in `HotSignalCatalog` and not a compound MUST end up in `signal_observations` exactly once

## Validation

```powershell
go test -race -count=1 ./internal/api/... ./internal/telemetry/...
```

Plus end-to-end:
1. Apply migration 000142 on a fresh local DB
2. Replay 1 hour of fleet telemetry from `backups/data.dump`
3. Verify:
   ```sql
   -- Hot tables populated
   SELECT count(*) FROM positions;
   SELECT count(*) FROM charging_telemetry;
   SELECT count(*) FROM climate_snapshots;
   -- Cold table populated
   SELECT count(*) FROM signal_observations;
   -- Catalog populated
   SELECT count(*) FROM signal_catalog;
   -- No JSONB anywhere outside the carve-out
   SELECT table_name, column_name FROM information_schema.columns
   WHERE data_type = 'jsonb' AND table_schema = 'public';
   -- expect: only automation_actions.command_params
   ```

## Exit gate

- [ ] `signals jsonb` writes removed from telemetry_handler.go
- [ ] All compound expanders have unit tests with real Tesla payload fixtures
- [ ] HotSignalCatalog covers ~50 signals matching the Phase 3 selection
- [ ] Integration test passes: 100-signal batch routes correctly
- [ ] End-to-end replay of `backups/data.dump` produces non-zero rows in all expected tables
- [ ] `signal_observations` count > 0 (cold path is working)
- [ ] `signal_catalog` row count = distinct signal names seen
