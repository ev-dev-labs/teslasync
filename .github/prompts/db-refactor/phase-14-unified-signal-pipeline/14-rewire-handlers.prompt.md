---
description: "Phase-14 — Rewire API handlers to read from signal_log/Redis"
---
# Prompt 14 — Rewire API Handlers (read from signal_log / Redis)
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-14-rewire-handlers.log` |
| Allowed files to change | All `internal/api/*_handler.go` files that read from dropped tables, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 06 (SnapshotAt), 12 (writers removed), 13 (tables dropped)

## Problem

After dropping snapshot tables, any API handler that SELECTs from them will crash.
These handlers need to read from signal_log or Redis instead.

## Task

### 1. Survey — find all handlers reading from dropped tables

```bash
grep -rn "motor_snapshots\|climate_snapshots\|location_snapshots\|safety_snapshots\|battery_snapshots\|tire_pressure_snapshots\|user_preference_snapshots\|vehicle_meta_snapshots\|vehicle_live_state\|charging_telemetry\|charge_telemetry_readings\|drive_telemetry_readings" --include="*.go" internal/api/
```

Expected handlers to rewire (from earlier audit):
- `battery_degradation_handler.go` — reads charging_telemetry
- `battery_handler.go` — reads vehicle_live_state
- `drivetrain_health_handler.go` — reads motor_snapshots
- `energy_flow_handler.go` — reads vehicle_live_state
- `maintenance_handler.go` — reads vehicle_live_state
- `range_projection_handler.go` — reads drive_telemetry_readings
- `speed_profile_handler.go` — reads drive_telemetry_readings
- `signal_handler.go` — reads vehicle_live_state
- `watch_handler.go` — reads vehicle_live_state
- `charge_planner_handler.go` — reads charging_telemetry
- `command_handler.go` — reads vehicle_live_state

### 2. For each handler — choose the right replacement

| Old source | Replacement | When to use |
|---|---|---|
| `vehicle_live_state` (current value) | Redis HSET `GetAll()` or `GetSignal()` | Live dashboard, current state |
| `motor_snapshots` (historical) | `signal_log` query with motor signal names | Drivetrain health, motor history |
| `charging_telemetry` (during charge) | `SignalTrace(vehicleID, chargingSignals, start, end)` | Charge detail page |
| `drive_telemetry_readings` (during drive) | `SignalTrace(vehicleID, driveSignals, start, end)` | Drive detail page |
| `climate_snapshots` (historical) | `signal_log` query with climate signal names | Climate history |
| `tire_pressure_snapshots` | `signal_log` query with TPMS signal names | Tire pressure page |

### 3. Pattern for rewiring

```go
// Before (reads from dropped table):
rows, err := h.db.Pool.Query(ctx,
    "SELECT regen_kw, front_torque FROM motor_snapshots WHERE vehicle_id = $1", vehicleID)

// After (reads from signal_log):
entries, err := h.signalLogReader.SignalTrace(ctx, vehicleID,
    []string{"RegenPower", "FrontTorque"}, from, to)
// Transform entries into the response format the frontend expects
```

### Constraints

- **API response shape must not change** — frontend expects the same JSON keys
- Transform signal_log results into the existing response structs
- If signal_log has no data for a time range, return empty arrays (not errors)
- Wire `signalLogReader` and `redisSignalCache` into handlers that need them

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify no references to dropped tables in handler code
grep -rn "motor_snapshots\|climate_snapshots\|vehicle_live_state\|charging_telemetry\|drive_telemetry_readings" --include="*.go" internal/api/ | grep -v "signal_log\|TODO\|legacy\|migration" | head -10
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero refs to dropped tables in handlers.
