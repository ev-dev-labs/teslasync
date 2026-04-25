---
description: "Phase-16 — Flatten compound signals (Location) into signal_log"
---
# Prompt 04 — Flatten Compound Signals in signal_history_writer
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-04-flatten-compound.log` |
| Allowed files to change | `internal/database/signal_history_writer.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

`signal_history_writer.go:83` skips ALL compound signals:
```go
case map[string]interface{}:
    continue // skip nested objects (Location, etc.)
```

This means **Location data never reaches signal_log**. Tesla sends Location as:
```json
{"Location": {"latitude": 37.7749, "longitude": -122.4194}}
```

The in-memory signal store and Redis handle this (they unpack it), but signal_log
doesn't — so `SnapshotAt()` can never find lat/lng, which breaks:
- Drive start/end coordinates → null lat/lon
- Geocoding → null addresses
- Position traces → empty maps
- Charge location detection → no geofence matching

## Task

### Replace the `map[string]interface{}: continue` with flattening logic

```go
case map[string]interface{}:
    // Flatten known compound signals into individual rows
    // Location → Latitude + Longitude
    if lat, ok := v["latitude"]; ok {
        if f, fOk := toFloat64(lat); fOk {
            w.buffer = append(w.buffer, SignalHistoryRow{
                VehicleID: vehicleID, Signal: "Latitude",
                ValueNum: &f, CreatedAt: now,
            })
        }
    }
    if lon, ok := v["longitude"]; ok {
        if f, fOk := toFloat64(lon); fOk {
            w.buffer = append(w.buffer, SignalHistoryRow{
                VehicleID: vehicleID, Signal: "Longitude",
                ValueNum: &f, CreatedAt: now,
            })
        }
    }
    // For all other compound signals, store as JSONB
    jsonBytes, err := json.Marshal(v)
    if err == nil {
        s := string(jsonBytes)
        w.buffer = append(w.buffer, SignalHistoryRow{
            VehicleID: vehicleID, Signal: name,
            ValueJsonb: &s, CreatedAt: now,
        })
    }
```

### Also check: does `SignalHistoryRow` have a `ValueJsonb` field?

If not (prompt 00 added the DB column but may not have updated the Go struct):
```go
type SignalHistoryRow struct {
    VehicleID  int64
    Signal     string
    ValueNum   *float64
    ValueStr   *string
    ValueBool  *bool
    ValueJsonb *string   // ADD if missing
    CreatedAt  time.Time
}
```

And update the `CopyFrom` column list to include `value_jsonb`.

### Verify the `toFloat64` helper is available

The writer is in package `database`. Check if `toFloat64` exists there or needs
to be called differently.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Replay a few signals and verify Latitude appears in signal_log
# (need to restart API first to pick up the change)
docker compose build teslasync-api && docker compose up -d teslasync-api
Start-Sleep 10
# Send a test Location signal
docker exec teslasync-mosquitto mosquitto_pub -t "telemetry/TEST00000000000VIN/v/Location" -m '{"latitude":37.7749,"longitude":-122.4194}'
Start-Sleep 3
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT signal, value_num FROM signal_log WHERE signal IN ('Latitude','Longitude') ORDER BY created_at DESC LIMIT 4;"
# Should show Latitude and Longitude rows
```

## Commit

```powershell
git add -A
git commit -m "phase-16/04-flatten-compound: flatten Location + store compound signals as JSONB

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/04-flatten-compound` as the commit message prefix.
