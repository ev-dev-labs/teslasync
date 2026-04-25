---
description: "Phase-15 — Fix range_projection_handler vehicle_live_state ref"
---
# Prompt 03 — range_projection_handler: vehicle_live_state → Redis
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-03-range-projection.log` |
| Allowed files to change | `internal/api/range_projection_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Line 102: `SELECT outside_temp FROM vehicle_live_state WHERE vehicle_id = $1`
Table `vehicle_live_state` is dropped.

## Task

Replace with Redis read:

```go
// Before:
_ = h.db.Pool.QueryRow(ctx,
    `SELECT outside_temp FROM vehicle_live_state WHERE vehicle_id = $1`,
    vehicleID).Scan(&currentOutsideTemp)

// After:
if h.redisCache != nil {
    if val, err := h.redisCache.GetSignal(ctx, vehicleID, "OutsideTemp"); err == nil {
        if f, ok := val.(float64); ok {
            currentOutsideTemp = &f
        }
    }
}
```

Also check if `range_projection_handler.go` has any other `battery_snapshots` refs
(the Phase 14 gate log mentioned it). If so, rewire those too using the same pattern
as prompt 14b (SnapshotAt for battery health data).

Wire `redisCache` (and `signalLogReader` if needed) into the handler struct.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -n "vehicle_live_state\|battery_snapshots" internal/api/range_projection_handler.go
# Should return 0 matches
```

## Commit

```powershell
git add -A
git commit -m "phase-15/03-range-projection: rewire vehicle_live_state + battery_snapshots to Redis/signal_log

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-15/03-range-projection` as the commit message prefix.
