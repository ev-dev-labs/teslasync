---
description: "Phase-16 — Audit drive completion: fill all null fields"
---
# Prompt 05 — Drive Completion Audit: Fix All Null Fields
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-05-drive-complete-audit.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 04 (Location now in signal_log)

## Problem

Drive 9 has these null fields that should be populated:

| Field | Value | Expected | Root cause |
|---|---|---|---|
| `start_lat` | null | 37.xx | SnapshotAt didn't find Latitude (fixed by prompt 04) |
| `start_lon` | null | -122.xx | Same |
| `end_lat` | null | coordinates | Same |
| `end_lon` | null | coordinates | Same |
| `start_address` | null | geocoded text | No lat/lon → no geocode |
| `end_address` | null | geocoded text | Same |
| `energy_used_kwh` | null | number | SnapshotAt for LifetimeEnergyUsed not wired |
| `regen_kwh` | null | number | RegenEnergy() not implemented or returns 0 |
| `score` | null | number | computeDriveScore() not implemented |
| `ended_status` | null | "completed" | Not set in UPDATE |

## Task

### 1. Survey the current drive completion code

Find the drive completion function in `telemetry_sessions.go`. Trace exactly what
it does when a drive ends. For each field in the `drives` table, verify it's being
SET in the UPDATE query.

### 2. Fix each null field

**start_lat/lon, end_lat/lon:**
```go
startSnap, _ := t.signalLogReader.SnapshotAt(ctx, vehicleID, drive.StartTs)
endSnap, _ := t.signalLogReader.SnapshotAt(ctx, vehicleID, endTs)

startLat := toFloat(startSnap["Latitude"])  // now available after prompt 04
startLon := toFloat(startSnap["Longitude"])
endLat := toFloat(endSnap["Latitude"])
endLon := toFloat(endSnap["Longitude"])
```

**energy_used_kwh:**
```go
startEnergy := toFloat(startSnap["LifetimeEnergyUsed"])
endEnergy := toFloat(endSnap["LifetimeEnergyUsed"])
energyUsed := endEnergy - startEnergy
if energyUsed < 0 { energyUsed = 0 }
```

**regen_kwh:**
Check if `DriveAggregates()` or `RegenEnergy()` exists on the signalLogReader.
If not, implement a simple version:
```go
// Sum negative power samples as regen estimate
// OR query signal_log for total_regen_kwh signal if available
```
If no regen signal data exists, set to 0 (not null).

**score:**
If `computeDriveScore()` doesn't exist, implement a basic version:
```go
func computeDriveScore(avgSpeed, maxSpeed, distance, regen, energy float64) float64 {
    score := 100.0
    if maxSpeed > 80 { score -= 10 }  // speeding penalty
    if energy > 0 && regen/energy > 0.2 { score += 5 }  // regen bonus
    if score < 0 { score = 0 }
    if score > 100 { score = 100 }
    return score
}
```
Or set to null if not enough data to compute meaningfully.

**ended_status:**
```go
// In the UPDATE query, add: ended_status = 'completed'
```

### 3. Ensure the UPDATE query includes ALL fields

The UPDATE for drive completion must set:
```sql
UPDATE drives SET
  end_ts = $endTs,
  duration_min = $duration,
  distance_mi = $distance,
  start_lat = $startLat, start_lon = $startLon,
  end_lat = $endLat, end_lon = $endLon,
  start_battery_pct = $startBattery, end_battery_pct = $endBattery,
  energy_used_kwh = $energyUsed,
  regen_kwh = $regenKwh,
  avg_speed_mph = $avgSpeed, max_speed_mph = $maxSpeed,
  avg_power_kw = $avgPower,
  outside_temp_avg_c = $outsideTemp, inside_temp_avg_c = $insideTemp,
  score = $score,
  ended_status = 'completed'
WHERE id = $driveID
```

Verify EVERY column in the `drives` table is covered.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Check the UPDATE query covers all fields
grep -A 20 "UPDATE drives SET" internal/api/telemetry_sessions.go | head -25
# Should include: start_lat, end_lat, energy_used_kwh, regen_kwh, score, ended_status
```

## Commit

```powershell
git add -A
git commit -m "phase-16/05-drive-complete-audit: fix all null fields in drive completion

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/05-drive-complete-audit` as the commit message prefix.
