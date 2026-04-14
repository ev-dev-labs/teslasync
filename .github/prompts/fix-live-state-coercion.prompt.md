---
description: "Fix live_state_repo bool→varchar coercion — boolean values crash batch insert into varchar columns"
---

# Fix: live_state_repo — Boolean Values Fail on VARCHAR Columns

## Error

```
failed to encode args[112]: unable to encode false into text format for varchar (OID 1043): cannot find encode plan
```

This causes the ENTIRE live_state batch flush to fail — meaning ALL signal values for that
vehicle are lost, not just the boolean one.

## Root Cause

`internal/database/live_state_repo.go` around line 546-554:

```go
// Current code — validates types but does NOT coerce for column type
switch v.(type) {
case float64, int, int64, bool, string, time.Time:
    // OK
default:
    continue
}
cols = append(cols, colName)
vals = append(vals, v)  // ← bool goes straight to pgx, which can't encode bool→varchar
```

The old v0.31.0 code had three coercion steps BEFORE appending to vals:
1. `isVarcharCol` → `fmt.Sprintf("%v", v)` (converts bool/float/int to string)
2. `isTimestampCol` → `time.Unix(int64(tv), 0).UTC()` (converts unix epoch to time.Time)
3. Everything else → raw value

## Fix

Replace the simple type validation (lines ~546-554) with proper coercion matching the
v0.31.0 pattern. The coercion must happen BEFORE `vals = append(vals, v)`.

**Reference from v0.31.0** (`D:\repos\teslasync-old\internal\database\live_state_repo.go` lines 489-514):

```go
switch v.(type) {
case float64, int, int64, bool, string, time.Time:
    // OK — these are base types pgx can handle
default:
    continue
}

// For varchar columns, ensure we write a string (not bool/float)
if isVarcharCol[colName] {
    vals = append(vals, fmt.Sprintf("%v", v))
} else if isTimestampCol[colName] {
    // Convert Unix timestamp (float64) to time.Time for timestamptz columns
    switch tv := v.(type) {
    case float64:
        if tv > 1e9 { // looks like Unix seconds
            vals = append(vals, time.Unix(int64(tv), 0).UTC())
        } else {
            continue // skip non-timestamp float
        }
    case time.Time:
        vals = append(vals, tv)
    default:
        continue
    }
} else {
    vals = append(vals, v)
}
cols = append(cols, colName)
```

**The key additions needed:**

1. **`isVarcharCol` map** — lists all varchar columns in vehicle_live_state. Check the table schema:
```bash
docker exec teslasync-postgres psql -U teslasync -c "\d vehicle_live_state" | grep "character varying"
```

2. **`isTimestampCol` map** — lists timestamptz columns that receive unix epoch floats:
```go
var isTimestampCol = map[string]bool{
    "tpms_last_seen_pressure_time_fl": true,
    "tpms_last_seen_pressure_time_fr": true,
    "tpms_last_seen_pressure_time_rl": true,
    "tpms_last_seen_pressure_time_rr": true,
}
```

3. **Coercion logic** — between type validation and append:
   - varchar column + any type → `fmt.Sprintf("%v", v)`
   - timestamptz column + float64 → `time.Unix(int64(v), 0).UTC()`
   - everything else → raw value

## Also Check

The same pattern may exist in:
- Motor snapshot insert — verify string values aren't being inserted into numeric columns
- Climate snapshot insert — verify enum strings are handled for numeric columns

```bash
grep -n "vals = append\|Scan\|Insert" internal/database/motor_repo.go | head -20
grep -n "vals = append\|Scan\|Insert" internal/database/climate_repo.go | head -20
```

## Verification

```bash
# Build
go build ./...

# Clear and reseed
docker exec teslasync-postgres psql -U teslasync -c "TRUNCATE positions, drives, charging_sessions, motor_snapshots, climate_snapshots, battery_snapshots, vehicle_states, vehicle_live_state, daily_mileage, drive_telemetry_readings, charge_telemetry_readings, charging_telemetry CASCADE"

# Reseed vehicle
# (run seed-test-vehicle.sql)

# Restart API
docker compose restart teslasync-api
sleep 10

# Replay
node scripts/replay-signals.js --speed=max

# Check — warnings should be 0 (excluding auth/command proxy)
docker logs teslasync-api --tail 200 2>&1 | grep -c "flush failed\|failed to store\|failed to encode"
# Target: 0

# Check data landed
docker exec teslasync-postgres psql -U teslasync -c "
SELECT 'drives' as tbl, count(*) FROM drives WHERE vehicle_id=1
UNION ALL SELECT 'charging', count(*) FROM charging_sessions WHERE vehicle_id=1
UNION ALL SELECT 'positions', count(*) FROM positions WHERE vehicle_id=1
UNION ALL SELECT 'motor', count(*) FROM motor_snapshots WHERE vehicle_id=1
UNION ALL SELECT 'climate', count(*) FROM climate_snapshots WHERE vehicle_id=1
ORDER BY 1"
# All should have > 0 rows

**COMPLETION DEFINITION:**
- [ ] `isVarcharCol` map added with all varchar columns from vehicle_live_state
- [ ] `isTimestampCol` map added with TPMS timestamp columns
- [ ] Bool→varchar coercion: `fmt.Sprintf("%v", v)` for varchar columns
- [ ] Float→timestamptz coercion: `time.Unix(int64(v), 0).UTC()`
- [ ] Go builds clean
- [ ] Signal replay produces 0 "flush failed" / "failed to encode" errors
- [ ] motor_snapshots, climate_snapshots have > 0 rows after replay
```
