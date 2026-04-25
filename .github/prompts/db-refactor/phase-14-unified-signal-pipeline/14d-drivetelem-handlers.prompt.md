---
description: "Phase-14 — Rewire handlers reading drive_telemetry_readings → signal_log"
---
# Prompt 14d — Rewire drive_telemetry_readings Readers → signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-14d-drivetelem-handlers.log` |
| Allowed files to change | `speed_profile_handler.go`, `drive_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SnapshotAt), 23 (SignalTracePivot)

## Exactly 2 handlers to fix

### 1. `speed_profile_handler.go:55-71` — speed distribution histogram

Old query:
```sql
SELECT speed_bucket, COUNT(*), AVG(power)
FROM drive_telemetry_readings
WHERE vehicle_id = $1 AND speed > 0 AND created_at > NOW() - interval '30 days'
GROUP BY speed_bucket
```

New query (directly on signal_log):
```sql
SELECT
  CASE
    WHEN value_num < 15 THEN '0-15'
    WHEN value_num < 30 THEN '15-30'
    WHEN value_num < 45 THEN '30-45'
    WHEN value_num < 60 THEN '45-60'
    WHEN value_num < 75 THEN '60-75'
    ELSE '75+'
  END AS speed_bucket,
  COUNT(*) AS readings,
  0 AS avg_power_kw
FROM signal_log
WHERE vehicle_id = $1 AND signal = 'VehicleSpeed'
  AND value_num IS NOT NULL AND value_num > 0
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY speed_bucket
ORDER BY MIN(value_num)
```

Note: `avg_power_kw` per speed bucket requires a correlated query joining VehicleSpeed
and PackVoltage×PackCurrent at the same timestamp. This is complex — use 0 for now
and add as a follow-up if needed.

### 2. `drive_handler.go:605` — acceleration distribution

Old: calls `fn_driving_acceleration_distribution` which reads `drive_telemetry_readings`

New: compute acceleration from consecutive VehicleSpeed signals:
```go
// Query speed signals during all drives in the time range
// For each consecutive pair: accel_g = (speed2 - speed1) / (dt_seconds) / 9.81
// Return the array of G-force values

rows, err := h.signalLogReader.SignalTrace(ctx, vehicleID,
    []string{"VehicleSpeed"}, from, to)
// Iterate pairs: (rows[i+1].value - rows[i].value) / (rows[i+1].ts - rows[i].ts).Seconds() / 9.81
```

Also: drop the old Postgres function `fn_driving_acceleration_distribution` in the
migration from prompt 13 (add `DROP FUNCTION IF EXISTS fn_driving_acceleration_distribution;`).

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "drive_telemetry_readings\|fn_driving_acceleration" --include="*.go" internal/api/speed_profile_handler.go internal/api/drive_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero dropped-table refs in these 2 files.
