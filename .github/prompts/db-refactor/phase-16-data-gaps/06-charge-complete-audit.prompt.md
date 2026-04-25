---
description: "Phase-16 — Audit charge completion: fill all null fields"
---
# Prompt 06 — Charge Completion Audit: Fix All Null Fields
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-06-charge-complete-audit.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 04 (Location now in signal_log)

## Task

Same audit as prompt 05, but for charge completion. Check the `charging_sessions`
table columns and verify every field is populated at charge completion.

### Columns to verify in the UPDATE:

```sql
UPDATE charging_sessions SET
  end_ts = $endTs,
  duration_min = $duration,
  start_battery_pct = $startBattery,
  end_battery_pct = $endBattery,
  energy_added_kwh = $energyAdded,
  miles_added = $milesAdded,
  charger_type = $chargerType,
  charger_location = $location,       -- geocoded from SnapshotAt Latitude/Longitude
  charger_power_kw_max = $maxPower,
  charger_power_kw_avg = $avgPower,
  cost = $cost,
  ended_status = 'completed'
WHERE id = $sessionID
```

### Signal sources for each field:

| Field | Signal | Method |
|---|---|---|
| start/end_battery_pct | BatteryLevel | SnapshotAt start/end |
| energy_added_kwh | ACChargingEnergyIn | Delta (end - start) |
| miles_added | EstBatteryRange or BatteryRange | Delta (end - start), unit-normalized |
| charger_type | DCChargingPower > 0 → "DC", else "AC" | SnapshotAt end |
| charger_location | Latitude + Longitude | SnapshotAt end → reverse geocode |
| charger_power_kw_max | ACChargingPower or DCChargingPower | MAX from signal_log during window |
| charger_power_kw_avg | Same | AVG from signal_log during window |
| cost | energy_added × geofence electricity rate | Geofence lookup at end lat/lon |

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -A 15 "UPDATE charging_sessions SET" internal/api/telemetry_sessions.go | head -20
# Should include all columns listed above
```

## Commit

```powershell
git add -A
git commit -m "phase-16/06-charge-complete-audit: fix all null fields in charge completion

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/06-charge-complete-audit` as the commit message prefix.
