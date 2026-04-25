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

    // Start/end location
    startLat := toFloat(startSnap["Latitude"])
    startLon := toFloat(startSnap["Longitude"])
    endLat := toFloat(endSnap["Latitude"])
    endLon := toFloat(endSnap["Longitude"])

    // Temperature (unit-aware)
    endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")
    outsideTempAvg := units.NormalizeTemp(toFloat(endSnap["OutsideTemp"]), endTempUnit)
    insideTempAvg := units.NormalizeTemp(toFloat(endSnap["InsideTemp"]), endTempUnit)

    // Energy: delta of cumulative counters
    startEnergy := toFloat(startSnap["LifetimeEnergyUsed"])
    endEnergy := toFloat(endSnap["LifetimeEnergyUsed"])
    energyUsed := endEnergy - startEnergy
    if energyUsed < 0 { energyUsed = 0 }

    // Aggregates from signal_log during the drive window
    // Use a dedicated aggregate query for speed, power, regen:
    //
    // SELECT
    //   AVG(value_num) FILTER (WHERE signal = 'VehicleSpeed' AND value_num > 0) AS avg_speed,
    //   MAX(value_num) FILTER (WHERE signal = 'VehicleSpeed') AS max_speed,
    //   AVG(value_num) FILTER (WHERE signal = 'PackCurrent') AS avg_current,
    //   AVG(value_num) FILTER (WHERE signal = 'PackVoltage') AS avg_voltage
    // FROM signal_log
    // WHERE vehicle_id = $1 AND created_at BETWEEN $2 AND $3
    avgSpeed, maxSpeed, avgPower := t.signalLogReader.DriveAggregates(ctx, vehicleID, startTs, endTs)

    // Regen energy (sum of negative power samples × time interval, or delta of regen counter)
    // If RegenPower signal exists, aggregate it. Otherwise estimate from PackCurrent < 0 periods.
    regenKwh := t.signalLogReader.RegenEnergy(ctx, vehicleID, startTs, endTs)

    // Drive score (computed from driving metrics — acceleration smoothness, regen usage, etc.)
    score := computeDriveScore(avgSpeed, maxSpeed, distance, regenKwh, energyUsed)

    // UPDATE drives with ALL computed fields
    // UPDATE drives SET
    //   end_ts = $endTs,
    //   duration_min = $duration,
    //   distance_mi = $distance,
    //   start_lat = $startLat, start_lon = $startLon,
    //   end_lat = $endLat, end_lon = $endLon,
    //   start_battery_pct = $startBattery, end_battery_pct = $endBattery,
    //   energy_used_kwh = $energyUsed, regen_kwh = $regenKwh,
    //   avg_speed_mph = $avgSpeed, max_speed_mph = $maxSpeed,
    //   avg_power_kw = $avgPower,
    //   outside_temp_avg_c = $outsideTempAvg, inside_temp_avg_c = $insideTempAvg,
    //   score = $score, ended_status = 'completed'
    // WHERE id = $active.DriveID
}
```

### Add helper methods to SignalLogReader

Add to `signal_log_reader.go` (created in prompt 06):

```go
// DriveAggregates computes avg speed, max speed, avg power during a time window.
func (r *SignalLogReader) DriveAggregates(ctx context.Context, vehicleID int64, from, to time.Time) (avgSpeed, maxSpeed, avgPower float64)

// RegenEnergy estimates regen energy recovered during a time window.
// Sums RegenPower signal samples if available, or estimates from negative PackCurrent.
func (r *SignalLogReader) RegenEnergy(ctx context.Context, vehicleID int64, from, to time.Time) float64
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



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/09-drive-complete: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/09-drive-complete` as the commit message prefix.

