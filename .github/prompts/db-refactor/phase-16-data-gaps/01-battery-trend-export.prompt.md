---
description: "Phase-16 — Battery trend in export (analytics.go + processor.go)"
---
# Prompt 01 — Battery Trend in Export
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-01-battery-trend-export.log` |
| Allowed files to change | `internal/export/analytics.go`, `internal/export/processor.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00

## Problem

Two battery-related export functions return empty data / TODO stubs:

1. **`export/analytics.go` ~line 103** — Battery health in export returns empty.
2. **`export/analytics.go` ~line 217** — Battery trend in export returns empty.

These need the same `cagg_battery_daily` query pattern established in Prompt 00.

## Task

### 1. analytics.go — Battery health export

Replace the empty stub with a `cagg_battery_daily` query (or `SignalLogReader.SnapshotAt`) for the vehicle's latest battery level. Format the result for CSV/JSON export.

### 2. analytics.go — Battery trend export

Replace the empty stub with a `cagg_battery_daily` time-series query for the vehicle. Return date + avg/min/max battery level rows suitable for export.

### 3. processor.go — Wire SignalLogReader

If `analytics.go` functions need `SignalLogReader`, add it to the `Processor` struct in `processor.go` and inject it in `NewProcessor()`. The `Processor` already has access to `*database.DB`, so it can instantiate `SignalLogReader` directly:

```go
signalLogReader: database.NewSignalLogReader(db.Pool),
```

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...
# Verify no empty stubs remain:
Select-String -Path internal\export\analytics.go -Pattern "return \[\]|TODO.*signal_log|TODO.*battery"
# Should return 0 matches
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/01-battery-trend-export: fill battery trend + health in export from cagg_battery_daily

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/01-battery-trend-export` as the commit message prefix.
