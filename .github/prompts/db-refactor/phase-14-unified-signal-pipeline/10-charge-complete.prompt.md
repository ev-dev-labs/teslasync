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

    // Location for geocoding
    lat := toFloat(endSnap["Latitude"])
    lng := toFloat(endSnap["Longitude"])

    // Charger type detection
    chargerType := "AC"
    if dcPower := toFloat(endSnap["DCChargingPower"]); dcPower > 0 {
        chargerType = "DC"
    }

    // Max/avg power from signal trace during charge
    // ... query signal_log for ChargerPower signals between start-end

    // UPDATE charging_sessions SET end_ts=$1, energy_added_kwh=$2, ...
}
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
