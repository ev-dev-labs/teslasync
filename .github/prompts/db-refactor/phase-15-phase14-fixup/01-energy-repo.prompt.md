---
description: "Phase-15 — Remove BatterySnapshotRepo from energy_repo.go"
---
# Prompt 01 — energy_repo: Remove battery_snapshots References
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-01-energy-repo.log` |
| Allowed files to change | `internal/database/energy_repo.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

`energy_repo.go` contains `BatterySnapshotRepo` with two methods that query
`battery_snapshots` (dropped table):
- Line 91: `GetByVehicle` — `SELECT ... FROM battery_snapshots`
- Line 110: `Create` — `INSERT INTO battery_snapshots`

## Task

### Option A: Remove BatterySnapshotRepo entirely

If no other code calls `GetByVehicle` or `Create` on `BatterySnapshotRepo`, delete
the struct and both methods. Search first:

```bash
grep -rn "BatterySnapshotRepo\|batterySnapshotRepo\|batSnapRepo" --include="*.go" internal/
```

If callers exist (e.g., `maintenance_worker.go`, handlers), they need to be updated
to use `SignalLogReader` instead — but that's prompt 02's job for maintenance_worker
and prompt 03 for handlers.

For this prompt: if `BatterySnapshotRepo` is only used by files that are being fixed
in prompts 02-04, **delete the repo** and let those prompts fix the callers.

If something outside prompts 02-04 uses it, rewire `GetByVehicle` to query signal_log:
```go
func (r *BatterySnapshotRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.BatterySnapshot, error) {
    // Query signal_log for battery health signals
    // Return derived BatterySnapshot structs
}
```

### Option B: Keep but rewire to signal_log

If the BatterySnapshot model is used widely, keep the struct but change the queries
to read from signal_log instead of the dropped table.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -n "battery_snapshots" internal/database/energy_repo.go
# Should return 0 matches
```

## Commit

```powershell
git add -A
git commit -m "phase-15/01-energy-repo: remove BatterySnapshotRepo (table dropped)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-15/01-energy-repo` as the commit message prefix.
