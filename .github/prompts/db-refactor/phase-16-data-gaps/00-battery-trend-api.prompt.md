---
description: "Phase-16 — Battery trend from cagg_battery_daily (API handlers)"
---
# Prompt 00 — Battery Trend from cagg_battery_daily (API)
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-00-battery-trend-api.log` |
| Allowed files to change | `internal/api/battery_handler.go`, `internal/api/analytics_handler.go`, `internal/api/router.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Three battery-related handlers return empty data / TODO stubs instead of real queries:

1. **`battery_handler.go` ~line 75** — Monthly battery trend returns `[]`.
   Should query `cagg_battery_daily` for BatteryLevel over time.
2. **`analytics_handler.go` ~line 124** — Per-vehicle battery health returns empty.
   Should use `SignalLogReader.SnapshotAt(now)` for latest BatteryLevel + derive health.
3. **`analytics_handler.go` ~line 268** — Battery trend in fleet analytics returns empty.
   Same pattern as battery_handler trend.

## Task

### 1. battery_handler.go — Monthly battery trend

Replace the empty-array stub with a query against `cagg_battery_daily`:

```sql
SELECT bucket, avg_battery_level, min_battery_level, max_battery_level
FROM cagg_battery_daily
WHERE vehicle_id = $1 AND bucket >= $2
ORDER BY bucket ASC
```

Return the rows as JSON. The time range should default to 90 days if no query param is provided.

### 2. analytics_handler.go — Per-vehicle battery health

Use `SignalLogReader.SnapshotAt(ctx, vehicleID, time.Now())` to get the latest BatteryLevel.
Derive a simple health percentage from it (e.g., BatteryLevel as-is, or compare to a baseline).
If `SignalLogReader` is not wired into `AnalyticsHandler`, add it to the struct and constructor.

### 3. analytics_handler.go — Fleet battery trend

Same query as battery_handler.go but aggregated across all vehicles (or a specific vehicle_id from the query param). Reuse the same cagg_battery_daily query pattern.

### 4. router.go — Wire SignalLogReader

If `AnalyticsHandler` needs `SignalLogReader` injected, update `router.go` to pass it in the constructor call. The `SignalLogReader` is already instantiated in the router (used by TelemetrySessionTracker). Pass the same instance to `AnalyticsHandler`.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...
# Verify no empty-array stubs remain in these files:
Select-String -Path internal\api\battery_handler.go,internal\api\analytics_handler.go -Pattern "return \[\]|TODO.*signal_log|TODO.*battery"
# Should return 0 matches
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/00-battery-trend-api: fill battery trend + health from cagg_battery_daily and signal_log

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/00-battery-trend-api` as the commit message prefix.
