---
description: "Phase-14 — Rewire all snapshot-backed endpoints (tire/motor/climate/etc.)"
---
# Prompt 26 — Snapshot Endpoints: Rewire to signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-26-snapshot-endpoints.log` |
| Allowed files to change | `internal/api/*_handler.go` files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 23 (SignalTracePivot)

## Problem

These endpoints read from dropped snapshot tables. Each needs to be rewired to
query signal_log using `SignalTracePivot` or `SnapshotAt` (for "latest" endpoints).

## Endpoints to rewire

| Route | Handler | Old Table | Pattern |
|---|---|---|---|
| `GET /tire-pressure` | `tire_pressure_handler.go` | `tire_pressure_snapshots` | `SignalTracePivot` (history) |
| `GET /tire-pressure/latest` | same | same | `SnapshotAt(now)` (latest) |
| `GET /motor` | `motor_handler.go` | `motor_snapshots` | `SignalTracePivot` (history) |
| `GET /motor/latest` | same | same | `SnapshotAt(now)` |
| `GET /climate` | `climate_handler.go` | `climate_snapshots` | `SignalTracePivot` (history) |
| `GET /climate/latest` | same | same | `SnapshotAt(now)` |
| `GET /security` | `security_handler.go` | `security_snapshots` | `SignalTracePivot` (history) |
| `GET /security/latest` | same | same | `SnapshotAt(now)` |
| `GET /user-preferences` | `user_preference_handler.go` | `user_preference_snapshots` | `SignalTracePivot` |
| `GET /user-preferences/latest` | same | same | `SnapshotAt(now)` |
| `GET /vehicle-config` | `vehicle_config_handler.go` | `vehicle_config_snapshots` | `SnapshotAt(now)` |
| `GET /location-snapshots` | `location_snapshot_handler.go` | `location_snapshots` | `SignalTracePivot` |
| `GET /location-snapshots/latest` | same | same | `SnapshotAt(now)` |
| `GET /safety` | `safety_handler.go` | `safety_snapshots` | `SignalTracePivot` |
| `GET /safety/latest` | same | same | `SnapshotAt(now)` |
| `GET /media` | `media_handler.go` | `media_snapshots` (if exists) | `SnapshotAt(now)` |

## Task

### For each endpoint above:

#### "List/history" endpoints → `SignalTracePivotFlat`

```go
// Example: tire pressure history
var tirePressureMappings = []database.SignalMapping{
    {Signal: "TpmsPressureFl", Field: "front_left"},
    {Signal: "TpmsPressureFr", Field: "front_right"},
    {Signal: "TpmsPressureRl", Field: "rear_left"},
    {Signal: "TpmsPressureRr", Field: "rear_right"},
}
rows, _ := h.signalLogReader.SignalTracePivotFlat(ctx, vehicleID, tirePressureMappings, from, to)
```

#### "Latest" endpoints → `SnapshotAt(now)`

```go
snap, _ := h.signalLogReader.SnapshotAt(ctx, vehicleID, time.Now().UTC())
result := map[string]interface{}{
    "front_left":  snap["TpmsPressureFl"],
    "front_right": snap["TpmsPressureFr"],
    "rear_left":   snap["TpmsPressureRl"],
    "rear_right":  snap["TpmsPressureRr"],
}
writeJSON(w, http.StatusOK, result)
```

### Signal mapping tables per domain

Define signal mappings at the top of each handler. Refer to Tesla Fleet Telemetry
signal names. If unsure of the exact signal name, survey signal_log:
```sql
SELECT DISTINCT signal FROM signal_log WHERE signal ILIKE '%tire%' OR signal ILIKE '%tpms%';
```

### Constraints

- **Match existing API response shape** — frontend expects the same JSON keys
- If a handler file doesn't exist (was deleted in prompt 12), check if the
  route still exists in `router.go`. If so, create a minimal handler.
- If a route is no longer meaningful (e.g., no data available), return empty array `[]`
- Wire `signalLogReader` into each handler
- For "latest" endpoints, `SnapshotAt(time.Now())` is equivalent to reading Redis — 
  but using signal_log ensures consistency. Alternatively, use Redis `GetAll()` for lower latency.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Test snapshot endpoints
$endpoints = @("/api/v1/tire-pressure?vehicle_id=1","/api/v1/tire-pressure/latest?vehicle_id=1","/api/v1/motor?vehicle_id=1","/api/v1/motor/latest?vehicle_id=1","/api/v1/climate?vehicle_id=1","/api/v1/climate/latest?vehicle_id=1","/api/v1/security?vehicle_id=1","/api/v1/security/latest?vehicle_id=1")
$pass=0;$fail=0
foreach($ep in $endpoints){try{Invoke-WebRequest -Uri "http://localhost:8080$ep" -TimeoutSec 5 -ErrorAction Stop|Out-Null;$pass++}catch{$fail++;Write-Host "FAIL: $ep"}}
Write-Host "$pass/$($pass+$fail) snapshot endpoints passing"
```

Log result. STATUS=DONE only if build passes AND all snapshot endpoints return 200.
