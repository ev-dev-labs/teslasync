---
description: "Phase-15 — Remove battery_snapshots from maintenance_worker"
---
# Prompt 02 — maintenance_worker: Remove battery_snapshots Creation
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-02-maintenance-worker.log` |
| Allowed files to change | `internal/worker/maintenance_worker.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 01 (BatterySnapshotRepo removed)

## Problem

`maintenance_worker.go` has 3 references to `battery_snapshots`:
- Line 110: log message counting `battery_snapshots_created`
- Line 227: `SELECT EXISTS(... FROM battery_snapshots ...)`
- Line 313: `INSERT INTO battery_snapshots ...`

The worker creates periodic battery health snapshots. Since `battery_snapshots` is
dropped and signal_log captures all battery signals, this snapshot creation is no
longer needed.

## Task

1. Find the battery snapshot creation section in the maintenance worker
2. **Remove the entire battery snapshot creation block** — the data is in signal_log
3. Remove the `battery_snapshots_created` log/counter
4. If the worker references `BatterySnapshotRepo`, remove that field and import
5. Keep other maintenance tasks (compression, TTL cleanup, etc.) intact

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -n "battery_snapshots" internal/worker/maintenance_worker.go
# Should return 0 matches
```

## Commit

```powershell
git add -A
git commit -m "phase-15/02-maintenance-worker: remove battery_snapshots creation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-15/02-maintenance-worker` as the commit message prefix.
