---
description: "Fix 4 telemetry handler type mismatches found during signal replay — motor varchar overflow, climate enum-as-float, timestamp coercion, stale first-replay data"
---

# Fix: Telemetry Handler Type Mismatches

## Context

Replaying 804K real production signals through the local MQTT pipeline revealed 4 type
mismatches that cause batch insert failures. These affect production too when new signal
values arrive.

## Bug 1 — Motor Snapshot: `varchar(50)` overflow on `RouteLine`

**Error:** `value too long for type character varying(50)`

**Root Cause:** The `RouteLine` signal contains base64-encoded route data (hundreds of chars).
When processed by the telemetry handler, it gets stored in `motor_snapshots` but the
di_state/gear/hvil columns are `varchar(50)`.

The issue is that `RouteLine` is NOT a motor signal — it shouldn't be stored in `motor_snapshots`
at all. It's being caught by the motor snapshot insert because the handler batches all signals
together.

**Fix in `internal/database/motor_repo.go`:**
The `Insert` method should only accept known motor fields. Unknown signals with string values
that don't match motor columns should be skipped.

Alternatively, in the telemetry handler's signal→motor mapping, ensure `RouteLine` and media
signals are excluded from motor snapshot processing.

**Also:** The `RouteLine` signal should be stored in `vehicle_live_state` which has a `TEXT`
column, not in motor snapshots.

Check `internal/database/live_state_repo.go` signal mapping for `RouteLine`:
```bash
grep -n "RouteLine\|route_line" internal/database/live_state_repo.go
```

If `RouteLine` maps to a `varchar` column in `vehicle_live_state`, widen it to `TEXT`:
```sql
ALTER TABLE vehicle_live_state ALTER COLUMN route_line TYPE TEXT;
```

## Bug 2 — Climate Snapshot: enum string stored as `double precision`

**Error:** `invalid input syntax for type double precision: "ClimateOverheatProtectionTempLimitLow"`

**Root Cause:** The `CabinOverheatProtectionTemperatureLimit` signal sends **string enum values**
like `"ClimateOverheatProtectionTempLimitLow"` but the climate snapshot column
`cabin_overheat_protection_temp_limit` is `double precision`.

The signal name maps to column `cabin_overheat_protection_temperature_limit` in live_state
(line 188 of live_state_repo.go), which is a separate column from the climate snapshot's
`cabin_overheat_protection_temp_limit`.

**Fix options:**
1. **Best:** In the climate repo's `Insert`, check if `CabinOverheatProtectionTempLimit` is a
   string and skip it (or map the enum to a numeric value)
2. **Alternative:** Add a `varchar` column for the enum and a `double precision` column for
   the numeric limit separately
3. **Quick:** In the telemetry handler's climate signal processing, skip non-numeric values
   for numeric columns:
   ```go
   if _, ok := val.(string); ok && isNumericCol {
       continue // skip string value for numeric column
   }
   ```

## Bug 3 — Live State: Unix timestamp float not converted to `timestamptz`

**Error:** `unable to encode 1.77535017e+09 into binary format for timestamptz`

**Root Cause:** The TPMS timestamp signals (`TpmsLastSeenPressureTimeFl`, etc.) send Unix epoch
as `float64` (e.g., `1775350170`). The live_state_repo has `isTimestampCol` mapping (line 44)
that should convert these, but the conversion code isn't being reached.

**Investigation:** The v0.31.0 code (line 498-506) handles this correctly:
```go
} else if isTimestampCol[colName] {
    switch tv := v.(type) {
    case float64:
        if tv > 1e9 { // looks like Unix seconds
            vals = append(vals, time.Unix(int64(tv), 0).UTC())
        }
    }
}
```

Check if the refactored `live_state_repo.go` has this same code path. The error suggests
the timestamp float is bypassing the `isTimestampCol` check.

```bash
grep -n "isTimestampCol" internal/database/live_state_repo.go
```

Verify the `isTimestampCol` map includes:
```go
var isTimestampCol = map[string]bool{
    "tpms_last_seen_pressure_time_fl": true,
    "tpms_last_seen_pressure_time_fr": true,
    "tpms_last_seen_pressure_time_rl": true,
    "tpms_last_seen_pressure_time_rr": true,
}
```

## Bug 4 — First Replay Stale Data (map[string]interface{})

**Error:** `unable to encode map[string]interface {}{"timestamp":"...", "value":7}`

**Root Cause:** The first replay used `JSON.stringify({value, timestamp})` as the MQTT payload
instead of raw `JSON.stringify(value)`. This was fixed in the replay script, but the stale
data from the first replay may still be in the signal store's in-memory buffer.

**Fix:** Restart the API server to clear the in-memory signal store:
```bash
docker compose restart teslasync-api
```

Then re-run the replay. But also add defensive handling in live_state_repo — if a value
is a `map[string]interface{}`, extract the `"value"` key:

```go
// In the type switch (line ~489):
case map[string]interface{}:
    // Fleet telemetry sends raw values, but some clients wrap them
    if inner, ok := v["value"]; ok {
        v = inner
    } else {
        continue
    }
```

## Also Missing: `fsm_transition_repo.go`

The comparison showed `fsm_transition_repo.go` is missing from the refactored repo.
Copy it from v0.31.0:
```bash
cp D:\repos\teslasync-old\internal\database\fsm_transition_repo.go internal\database\
```

## Verification

```bash
# Restart API to clear stale buffers
docker compose restart teslasync-api
sleep 10

# Re-run replay
node scripts/replay-signals.js --speed=max

# Wait for processing
sleep 5

# Check data landed
docker exec teslasync-postgres psql -U teslasync -c "
SELECT 'drives' as tbl, count(*) FROM drives WHERE vehicle_id=1
UNION ALL SELECT 'charging', count(*) FROM charging_sessions WHERE vehicle_id=1
UNION ALL SELECT 'positions', count(*) FROM positions WHERE vehicle_id=1
UNION ALL SELECT 'motor', count(*) FROM motor_snapshots WHERE vehicle_id=1
UNION ALL SELECT 'climate', count(*) FROM climate_snapshots WHERE vehicle_id=1
UNION ALL SELECT 'vehicle_states', count(*) FROM vehicle_states WHERE vehicle_id=1
ORDER BY 1"

# Check for errors
docker logs teslasync-api --tail 100 2>&1 | grep -c '"level":"warn"'
# Target: 0 (or near 0)

go build ./...
```

**COMPLETION DEFINITION:**
- [ ] Motor snapshot: RouteLine excluded from motor insert, varchar overflow resolved
- [ ] Climate snapshot: string enum for overheat temp handled (skip or map)
- [ ] Live state: TPMS timestamp floats properly converted to timestamptz
- [ ] Defensive handling for map[string]interface{} values
- [ ] fsm_transition_repo.go restored
- [ ] Go builds clean
- [ ] Signal replay produces 0 warnings
