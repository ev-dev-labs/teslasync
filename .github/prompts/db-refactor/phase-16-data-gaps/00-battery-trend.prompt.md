---
description: "Phase-16 — Battery trend from cagg_battery_daily"
---
# Prompt 00 — Battery Trend: Implement from cagg_battery_daily
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-00-battery-trend.log` |
| Allowed files to change | `internal/api/battery_handler.go`, `internal/api/analytics_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

These files have TODO stubs returning empty data where battery health queries
used to be:

### battery_handler.go:75
```go
// TODO: derive monthly battery trend from signal_log BatteryLevel aggregates
var trend []trendPoint  // always empty!
```

### analytics_handler.go:124 + 268
```go
// Battery health trend: derive from signal_log in future update
// TODO: implement via SignalLogReader.SignalTracePivot for BatteryLevel
```

## Task

### 1. Battery trend query (shared by both handlers)

Query `cagg_battery_daily` continuous aggregate (created in Phase 14 prompt 15):

```sql
SELECT
  TO_CHAR(bucket, 'YYYY-MM') AS month,
  AVG(end_soc) AS avg_soc,
  MIN(min_soc) AS min_soc,
  MAX(max_soc) AS max_soc,
  AVG(avg_pack_voltage) AS avg_voltage
FROM cagg_battery_daily
WHERE vehicle_id = $1
GROUP BY TO_CHAR(bucket, 'YYYY-MM')
ORDER BY month DESC
LIMIT $2
```

If `cagg_battery_daily` is not populated yet (fresh DB), fall back to direct signal_log:

```sql
SELECT
  TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS month,
  AVG(value_num) AS avg_soc
FROM signal_log
WHERE vehicle_id = $1 AND signal = 'BatteryLevel' AND value_num IS NOT NULL
GROUP BY month
ORDER BY month DESC
LIMIT $2
```

### 2. Fix battery_handler.go

Replace the empty `trend` with the query result. Derive health metrics:
- `health_score` = latest BatteryLevel max SOC range (if max SOC over a full charge < 100, degradation exists)
- `capacity_kwh` = derive from EnergyRemaining signal (already implemented at line 47)
- `monthly_trend` = query result from above

### 3. Fix analytics_handler.go

Replace both TODO blocks (lines 124, 268) with the same pattern:
- Per-vehicle: `SnapshotAt(now)` for latest BatteryLevel → derive health_score
- Trend: same monthly query as battery_handler

### Constraints

- If `cagg_battery_daily` has no data (not refreshed yet), return empty `[]` gracefully — don't error
- The `signalLogReader` is already wired into both handlers (Phase 14 did this)
- Keep the existing `nominalCapacity = 75.0` derivation for health_score as fallback

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify battery endpoint returns non-empty trend (if data exists)
curl -s http://localhost:8080/api/v1/vehicles/1/battery | python -m json.tool | Select-String "monthly_trend"
```

## Commit

```powershell
git add -A
git commit -m "phase-16/00-battery-trend: implement battery health from cagg_battery_daily

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/00-battery-trend` as the commit message prefix.
