---
description: "Phase-14 — Rewire handlers reading charging_telemetry → signal_log"
---
# Prompt 14c — Rewire charging_telemetry Readers → signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-14c-chargetelem-handlers.log` |
| Allowed files to change | `battery_degradation_handler.go`, `battery_handler.go`, `drivetrain_health_handler.go`, `energy_flow_handler.go`, `charge_planner_handler.go`, `range_projection_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SnapshotAt), 23 (SignalTracePivot)

## Exactly 6 handlers to fix

| Handler | Queries on charging_telemetry | Replacement |
|---|---|---|
| `battery_degradation_handler.go:177,612` | `energy_remaining, est_battery_range FROM charging_telemetry` | `SignalTrace` for BatteryLevel, ACChargingEnergyIn during charge windows |
| `battery_handler.go:64` | `energy_remaining, est_battery_range FROM charging_telemetry` | Same pattern |
| `drivetrain_health_handler.go:38` | `FROM charging_telemetry` for motor/battery health during charge | `SignalTrace` for PackVoltage, PackCurrent, BatteryLevel |
| `energy_flow_handler.go:43` | `FROM charging_telemetry` for energy flow | `SignalTrace` for ACChargingPower, energy signals |
| `charge_planner_handler.go` | charging_telemetry for optimization | `SignalTrace` for charge curve signals |
| `range_projection_handler.go:76,512` | `FROM charging_telemetry` for range estimate | `SignalTrace` for BatteryLevel, ACChargingEnergyIn |

## Common pattern

Most of these queries look like:
```sql
SELECT energy_remaining, est_battery_range FROM charging_telemetry
WHERE session_id = $1 ORDER BY ts DESC LIMIT 1
```

Replace with:
```go
// Get the charge session's time window
session, _ := chargeRepo.GetByID(ctx, sessionID)
snap, _ := signalLogReader.SnapshotAt(ctx, session.VehicleID, session.EndTs)
energyRemaining := toFloat(snap["ACChargingEnergyIn"])
estRange := toFloat(snap["BatteryRange"])
```

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "charging_telemetry" --include="*.go" internal/api/battery_degradation_handler.go internal/api/battery_handler.go internal/api/drivetrain_health_handler.go internal/api/energy_flow_handler.go internal/api/charge_planner_handler.go internal/api/range_projection_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero charging_telemetry refs in these 6 files.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/14c-chargetelem-handlers: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/14c-chargetelem-handlers` as the commit message prefix.

