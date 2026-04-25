---
description: "Phase-14 — Charge completion rewrite using signal_log"
---
# Prompt 10 — Charge Completion: SnapshotAt + Unit-Aware
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-10-charge-complete.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 06 (SnapshotAt), 07 (unit conversion)

## Task

Same pattern as prompt 09, but for charge session completion (~line 1560-1625).

```go
func (t *TelemetrySessions) completeCharge(ctx context.Context, vehicleID int64, active *activeCharge) {
    startTs := active.StartTime
    endTs := time.Now().UTC()

    startSnap, _ := t.signalLogReader.SnapshotAt(ctx, vehicleID, startTs)
    endSnap, _ := t.signalLogReader.SnapshotAt(ctx, vehicleID, endTs)

    startBattery := toInt(startSnap["BatteryLevel"])
    endBattery := toInt(endSnap["BatteryLevel"])

    // Energy added: difference in cumulative energy counter
    startEnergy := toFloat(startSnap["ACChargingEnergyIn"])
    endEnergy := toFloat(endSnap["ACChargingEnergyIn"])
    energyAdded := endEnergy - startEnergy
    if energyAdded < 0 { energyAdded = 0 }

    // Battery
    startBattery := toInt(startSnap["BatteryLevel"])
    endBattery := toInt(endSnap["BatteryLevel"])

    // Range added (miles): difference in rated range
    startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
    endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")
    startRange := units.NormalizeDistance(toFloat(startSnap["BatteryRange"]), startDistUnit)
    endRange := units.NormalizeDistance(toFloat(endSnap["BatteryRange"]), endDistUnit)
    milesAdded := endRange - startRange
    if milesAdded < 0 { milesAdded = 0 }

    // Location for geocoding (→ charger_location)
    lat := toFloat(endSnap["Latitude"])
    lng := toFloat(endSnap["Longitude"])

    // Charger type detection
    chargerType := "AC"
    if dcPower := toFloat(endSnap["DCChargingPower"]); dcPower > 0 {
        chargerType = "DC"
    }

    // Max/avg power from signal_log aggregate during charge
    // SELECT
    //   MAX(value_num) FILTER (WHERE signal = 'ACChargingPower') AS max_power,
    //   AVG(value_num) FILTER (WHERE signal = 'ACChargingPower' AND value_num > 0) AS avg_power,
    //   MAX(value_num) FILTER (WHERE signal = 'DCChargingPower') AS max_dc_power
    // FROM signal_log WHERE vehicle_id = $1 AND created_at BETWEEN $2 AND $3
    maxPower, avgPower := t.signalLogReader.ChargeAggregates(ctx, vehicleID, startTs, endTs)

    // Cost calculation (if geofence has electricity rate)
    cost := 0.0
    if lat != 0 && lng != 0 && energyAdded > 0 {
        geofences, _ := t.geofenceRepo.FindByCoordinates(ctx, lat, lng)
        // Apply geofence electricity rate if available
    }

    // Geocode location → charger_location
    chargerLocation := ""
    if lat != 0 && lng != 0 {
        chargerLocation = geocode(lat, lng) // existing reverse geocode
    }

    // Duration
    duration := endTs.Sub(startTs).Minutes()

    // UPDATE charging_sessions SET
    //   end_ts = $endTs, duration_min = $duration,
    //   start_battery_pct = $startBattery, end_battery_pct = $endBattery,
    //   energy_added_kwh = $energyAdded, miles_added = $milesAdded,
    //   charger_type = $chargerType, charger_location = $chargerLocation,
    //   charger_power_kw_max = $maxPower, charger_power_kw_avg = $avgPower,
    //   cost = $cost, ended_status = 'completed'
    // WHERE id = $active.SessionID
}
```

### Add helper method to SignalLogReader

```go
// ChargeAggregates computes max/avg charger power during a charge window.
// Checks both ACChargingPower and DCChargingPower, returns whichever is active.
func (r *SignalLogReader) ChargeAggregates(ctx context.Context, vehicleID int64, from, to time.Time) (maxPower, avgPower float64)
```

### Constraints

- Same as prompt 09: keep existing path as fallback, errors non-fatal, wire signalLogReader
- Location from snapshot enables geocoding even if no Location signal during the charge
- `ACChargingEnergyIn` is a cumulative counter — difference = energy added during this session

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
```

Log result. STATUS=DONE only if build passes.
