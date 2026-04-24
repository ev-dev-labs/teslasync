---
applyTo: "internal/api/telemetry*,internal/database/*_repo.go,internal/models/**,internal/worker/**"
---

# Telemetry Data Pipeline Instructions

## Data Flow

```
Tesla Car → Fleet Telemetry (protobuf) → MQTT → TelemetryHandler
                                                     │
                              ┌───────────────────────┼────────────────────┐
                              ▼                       ▼                    ▼
                      SignalStore (mem)     Snapshot Repos (DB)    vehicle_live_state
                      (hot cache for       (time-series history)  (single-row current)
                       live UI + alerts)
```

## Signal Processing Rules

### Signal Names

Tesla signals arrive with various naming conventions. The telemetry handler
normalizes them using a fallback chain:

```go
// Try canonical name first, then alternates
fl, flOk := signals["TirePressureFrontLeft"]
if !flOk { fl, flOk = signals["TPMS_FL"] }
if !flOk { fl, flOk = signals["TpmsPressureFl"] }
if !flOk { fl, flOk = signals["TpmsFl"] }
```

When adding new signal processing:
1. Check Tesla Fleet Telemetry proto for the canonical name
2. Check `internal/enums/signal_types.go` for the registered name
3. Add alternate names as fallbacks (Tesla changes naming between firmware versions)

### Unit-Aware Write Path

Raw values are stored AS RECEIVED from Tesla (no conversion). But each INSERT
must stamp the car's current unit preference from `vehicle_units`:

```go
// In trackTirePressure(), after collecting values:
var pressurePref string
_ = h.db.Pool.QueryRow(ctx,
    `SELECT car_pressure_pref FROM vehicle_units WHERE vehicle_id = $1`,
    vehicleID).Scan(&pressurePref)
snap.PressureUnit = models.ParsePressureUnit(pressurePref)
h.tirePressureRepo.Insert(ctx, snap)
```

### High-Frequency Tables — Cache the Unit Lookup

For tables with high write rates (positions: every 1–5s), don't query
`vehicle_units` on every INSERT. Instead, cache per-vehicle:

```go
type TelemetryHandler struct {
    // ...
    unitCache sync.Map  // map[int64]*cachedUnits
}

type cachedUnits struct {
    distanceUnit    models.DistanceUnit
    tempUnit        models.TemperatureUnit
    pressureUnit    models.PressureUnit
    updatedAt       time.Time
}

func (h *TelemetryHandler) getUnits(vehicleID int64) *cachedUnits {
    if cached, ok := h.unitCache.Load(vehicleID); ok {
        cu := cached.(*cachedUnits)
        if time.Since(cu.updatedAt) < 5*time.Minute {
            return cu
        }
    }
    // Refresh from DB
    // ...
}
```

The cache is refreshed when `SettingDistanceUnit` / `SettingTirePressureUnit`
signals arrive (rare) or every 5 minutes (fallback).

## vehicle_live_state — Single Source of Truth for Current State

`vehicle_live_state` is a **write-through single-row** table per vehicle.
Updated on every telemetry batch with zero lag.

```
❌ DO NOT read current state from snapshot tables (positions, climate_snapshots, etc.)
❌ DO NOT add new endpoints that query snapshot tables for "latest" values
✅ DO read current state from /vehicles/{id}/state → vehicle_live_state
✅ DO use snapshot tables ONLY for historical data (charts, timelines)
```

### Why?

Snapshot tables are time-series (hypertables). Querying `ORDER BY ts DESC LIMIT 1`
on a hypertable is expensive (full chunk scan) vs. a single-row PK lookup on
`vehicle_live_state`.

## Snapshot Table Conventions

### Table Structure

All snapshot tables follow this pattern:
```sql
CREATE TABLE <entity>_snapshots (
  vehicle_id   bigint NOT NULL REFERENCES vehicles(id),
  ts           timestamptz NOT NULL,
  -- ... entity-specific columns ...
  PRIMARY KEY (vehicle_id, ts)  -- composite PK for hypertable
);
```

- Composite PK `(vehicle_id, ts)` is required for TimescaleDB hypertables
- No auto-increment ID (the PK IS vehicle_id + timestamp)
- No `created_at` / `updated_at` (ts IS the timestamp)
- Exception: non-hypertable tables (drives, charging_sessions) keep `id` as PK

### Repo Pattern for Snapshots

```go
func (r *ClimateRepo) Insert(ctx context.Context, snap *models.ClimateSnapshot) error {
    query := `INSERT INTO climate_snapshots (vehicle_id, ts, inside_temp_c, ...)
              VALUES ($1, $2, $3, ...)
              ON CONFLICT (vehicle_id, ts) DO NOTHING`  // idempotent
    _, err := r.db.Pool.Exec(ctx, query, snap.VehicleID, snap.Ts, snap.InsideTempC, ...)
    return err
}
```

Key points:
- `ON CONFLICT DO NOTHING` for idempotent replay
- No RETURNING (we don't need the row back)
- The `ts` value comes from Tesla, not `time.Now()` — preserves event time

## Repo Method Naming

```go
// Standard CRUD
Create(ctx, entity)           // INSERT, returns error
GetByID(ctx, id)              // SELECT ... WHERE id = $1, returns (*Entity, error)
GetAll(ctx, limit, offset)    // SELECT with pagination
Update(ctx, id, entity)       // UPDATE ... WHERE id = $1
Delete(ctx, id)               // DELETE ... WHERE id = $1

// Snapshot-specific
Insert(ctx, snap)             // INSERT ... ON CONFLICT DO NOTHING
GetByVehicle(ctx, vid, limit) // SELECT ... WHERE vehicle_id = $1 ORDER BY ts DESC
GetLatest(ctx, vid)           // Convenience: GetByVehicle(ctx, vid, 1)[0]

// Batch
BatchInsert(ctx, snaps)       // Multiple INSERTs in one transaction

// Query-specific (named by what they return, not how)
ListByDateRange(ctx, vid, from, to, limit, offset)
GetDrivingStats(ctx, vid)     // aggregate query
```

## Data Integrity Rules

### No Silent Data Loss

```go
// ❌ BAD — silently drops data on error
if err := repo.Insert(ctx, snap); err != nil {
    return // data lost, no log
}

// ✅ GOOD — log + continue (telemetry handler shouldn't crash on one bad row)
if err := repo.Insert(ctx, snap); err != nil {
    log.Warn().Err(err).Int64("vehicle_id", snap.VehicleID).Msg("failed to insert snapshot")
    // continue processing other signals in this batch
}
```

### Idempotent Writes

Telemetry can be replayed (pod restart, MQTT retry). All writes must be idempotent:

```sql
-- ✅ Snapshot tables: ON CONFLICT DO NOTHING
INSERT INTO positions (...) VALUES (...) ON CONFLICT (vehicle_id, ts) DO NOTHING;

-- ✅ Singleton tables: UPSERT
INSERT INTO vehicle_live_state (vehicle_id, ...) VALUES ($1, ...)
ON CONFLICT (vehicle_id) DO UPDATE SET ...;

-- ❌ BAD — duplicate rows on replay
INSERT INTO positions (...) VALUES (...);
```

### Zero/Null Filtering

Some signals arrive as zero when the car is asleep or sensor unavailable:

```go
// ✅ GOOD — skip all-zero readings (car asleep)
if (snap.FrontLeft == nil || *snap.FrontLeft == 0) &&
   (snap.FrontRight == nil || *snap.FrontRight == 0) {
    return nil // skip
}

// ❌ BAD — stores meaningless zeros
repo.Insert(ctx, snap) // all zeros stored, pollutes charts
```

## Adding a New Telemetry Signal

Checklist for adding a new signal (e.g., "TireTempFrontLeft"):

```
□ 1. Register in internal/enums/signal_types.go (TypeFloat64/TypeEnum/etc.)
□ 2. Add field to the snapshot model struct (models/*.go) with db + json tags
□ 3. Add column to migration (ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
□ 4. Add to repo INSERT SQL + Scan + args (verify counts match!)
□ 5. Add signal extraction in telemetry_handler.go trackXxx() method
□ 6. Add to vehicle_live_state column mapping in live_state_repo.go
□ 7. Add to SignalStore hot catalog if needed for real-time UI
□ 8. Add to fleet-telemetry-config.json subscription list
□ 9. Add unit column or reuse existing (distance_unit, temp_unit, pressure_unit)
□ 10. Update frontend type in web/src/api/types.ts
□ 11. Wire into relevant frontend page with unit conversion
```
