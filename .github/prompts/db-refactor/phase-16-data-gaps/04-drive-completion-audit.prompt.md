---
description: "Phase-16 — Drive completion audit: fix ALL null fields in drives UPDATE"
---
# Prompt 04 — Drive Completion Audit
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-04-drive-completion-audit.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 03 (Location flattening must land first so SnapshotAt returns Latitude/Longitude)

## Problem

The `drives` table has 20 nullable columns. `completeDriveLocked()` (~line 1437) attempts
to populate most of them via in-memory accumulators + signal_log enrichment + backfill, but
an audit shows gaps:

### drives table schema (all nullable columns):
```
start_address, end_address, start_lat, start_lon, end_lat, end_lon,
start_battery_pct, end_battery_pct, energy_used_kwh, regen_kwh,
avg_speed_mph, max_speed_mph, avg_power_kw,
outside_temp_avg_c, inside_temp_avg_c, score, ended_status
```

### What's already handled (verify these actually work):
- `start_lat`, `start_lon`, `end_lat`, `end_lon` — from in-memory + signal_log snapshots
- `start_battery_pct`, `end_battery_pct` — from signal_log snapshots
- `energy_used_kwh` — from LifetimeEnergyUsed delta
- `regen_kwh` — from `signalLogReader.RegenEnergy()`
- `avg_speed_mph`, `max_speed_mph` — from `signalLogReader.DriveAggregates()`
- `avg_power_kw` — from `signalLogReader.DriveAggregates()`
- `outside_temp_avg_c`, `inside_temp_avg_c` — from signal_log snapshots
- `start_address`, `end_address` — from async geocoding
- `distance_mi` — from odometer delta or speed × time estimate

### What's NEVER set:
- **`score`** — always NULL. No logic computes a drive score.
- **`ended_status`** — always NULL. No logic sets 'completed'/'aborted'/'interrupted'/'unknown'.

## Task

### 1. Survey — Trace every nullable column

In the log under `=== SURVEY ===`, list every nullable column in `drives` and trace which
line of code sets it. Confirm each path works when signal_log has data. Flag any column that
has no write path.

### 2. Add `ended_status`

In `completeDriveLocked()`, set `ended_status` based on how the drive ended:

- If `signals != nil` (normal FSM transition ended the drive) → `"completed"`
- If drive was closed by stale-session cleanup (signals is nil, called from `cleanupStaleSessions`) → `"interrupted"`
- If drive duration < 1 minute or distance < 0.1 miles → `"aborted"`
- Default → `"unknown"`

Add `ended_status` to `enhancedFields` so it gets written via `PartialUpdateWithTx`.

### 3. Add `score` (basic drive score)

Compute a simple drive score (0-100) from available data:

```go
// Basic scoring: start at 100, deduct for aggressive driving indicators
score := 100.0
if maxSpeed > 85 { score -= 10 }  // excessive speed
if active.HardBrakeCount > 0 { score -= float64(active.HardBrakeCount) * 5 }
if active.HardAccelCount > 0 { score -= float64(active.HardAccelCount) * 3 }
if regenKwh > 0 && energyUsed > 0 {
    regenRatio := regenKwh / energyUsed
    if regenRatio > 0.3 { score += 5 } // good regen usage
}
if score < 0 { score = 0 }
enhancedFields["score"] = score
```

If `HardBrakeCount`/`HardAccelCount` fields don't exist on `streamingDrive`, add them
(increment in the signal accumulation loop when speed delta exceeds thresholds), or use a
simpler formula based on what data IS available (e.g., max_speed, avg_speed, regen ratio).

### 4. Audit orphan closure

The orphan-closure UPDATE at ~line 812-814 only sets `end_ts` and `duration_min`. It should
also set `ended_status = 'interrupted'` since these are drives that weren't properly closed:

```sql
UPDATE drives SET end_ts = $1,
  duration_min = EXTRACT(EPOCH FROM ($1 - start_ts))/60,
  ended_status = 'interrupted'
WHERE end_ts IS NULL AND start_ts < $2
```

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify ended_status is set in completion:
Select-String -Path internal\api\telemetry_sessions.go -Pattern 'ended_status'
# Should return multiple matches (normal completion + orphan closure)

# Verify score is set:
Select-String -Path internal\api\telemetry_sessions.go -Pattern '"score"'
# Should return at least 1 match in enhancedFields
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/04-drive-completion-audit: add ended_status + score, fix orphan closure UPDATE

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/04-drive-completion-audit` as the commit message prefix.
