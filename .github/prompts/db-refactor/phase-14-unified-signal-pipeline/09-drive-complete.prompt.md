---
description: "Phase-14 — Drive completion rewrite using signal_log"
---
# Prompt 09 — Drive Completion: SnapshotAt + Unit-Aware
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-09-drive-complete.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 06 (SnapshotAt), 07 (unit conversion)

## Problem

Drive completion in `telemetry_sessions.go` builds `enhancedFields` from accumulated
Go struct fields. If a signal wasn't received during the drive session, the field is
nil/zero. This is the core missing context problem.

## Task

### Rewrite drive completion to use signal_log

Find the drive completion function (~line 1450-1550 area in telemetry_sessions.go).
Replace the enhancedFields accumulation with signal_log queries:

```go
func (t *TelemetrySessions) completeDrive(ctx context.Context, vehicleID int64, active *activeDrive) {
    startTs := active.StartTime
    endTs := time.Now().UTC()

    // Full signal snapshots at start and end
    startSnap, _ := t.signalLogReader.SnapshotAt(ctx, vehicleID, startTs)
    endSnap, _ := t.signalLogReader.SnapshotAt(ctx, vehicleID, endTs)

    // Unit preferences at start and end (may differ if user changed mid-drive)
    startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
    endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")
    endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")

    // Compute normalized values (always miles, °C)
    startOdo := units.NormalizeDistance(toFloat(startSnap["Odometer"]), startDistUnit)
    endOdo := units.NormalizeDistance(toFloat(endSnap["Odometer"]), endDistUnit)
    distance := endOdo - startOdo
    if distance < 0 { distance = 0 } // sanity

    startBattery := toInt(startSnap["BatteryLevel"])
    endBattery := toInt(endSnap["BatteryLevel"])

    outsideTempAvg := units.NormalizeTemp(toFloat(endSnap["OutsideTemp"]), endTempUnit)
    insideTempAvg := units.NormalizeTemp(toFloat(endSnap["InsideTemp"]), endTempUnit)

    // Aggregates from signal_log during the drive window
    // (avg speed, max speed from SignalTrace or aggregate query)
    driveSignals, _ := t.signalLogReader.SnapshotBetween(ctx, vehicleID, startTs, endTs)
    // ... compute avg_speed, max_speed from driveSignals or separate aggregate query

    // Write to drives table
    // UPDATE drives SET end_ts=$1, distance_mi=$2, avg_speed_mph=$3, ...
    // WHERE id = $active.DriveID
}
```

### Constraints

- **Wire `signalLogReader *database.SignalLogReader`** into TelemetrySessions struct
- **Keep the existing `enhancedFields` path as fallback** — if signalLogReader is nil
  or SnapshotAt returns empty, fall through to existing accumulated fields
- **SnapshotAt errors are non-fatal** — log warn, continue with whatever data is available
- **Do NOT remove** the existing active session struct fields yet — they serve as fallback
- Use `units.NormalizeDistance/Temp` from prompt 07

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
```

Log result. STATUS=DONE only if build passes. Integration test in prompt 17.
