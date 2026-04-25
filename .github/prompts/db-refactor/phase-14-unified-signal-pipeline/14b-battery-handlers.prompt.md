---
description: "Phase-14 — Rewire handlers reading battery_snapshots → signal_log"
---
# Prompt 14b — Rewire battery_snapshots Readers → signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-14b-battery-handlers.log` |
| Allowed files to change | `battery_degradation_handler.go`, `range_projection_handler.go`, `trip_planner_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SnapshotAt), 23 (SignalTracePivot)

## Exactly 3 handlers to fix

| Handler | Queries on battery_snapshots | Replacement |
|---|---|---|
| `battery_degradation_handler.go:52,95,563` | `FROM battery_snapshots` (3 queries for health_score, capacity, degradation) | `SnapshotAt` for latest, `SignalTrace` for history of BatteryLevel, PackVoltage signals |
| `range_projection_handler.go:120,534` | `health_score FROM battery_snapshots` | `SnapshotAt(now)` → derive health from BatteryLevel + cycle count |
| `trip_planner_handler.go:457,468` | `capacity_kwh FROM battery_snapshots`, `health_score FROM battery_snapshots` | `SnapshotAt(now)` → same derivation |

## Task

For each handler:
1. Survey the exact SQL query and what columns it reads
2. Replace with equivalent signal_log query:
   - Latest battery health → `SnapshotAt(now)` for BatteryLevel, PackVoltage, LifetimeEnergyUsed
   - Historical battery data → `SignalTracePivot` with BatteryLevel over time
   - `capacity_kwh` → derive from vehicle config or use hardcoded nominal (75 kWh Model Y)
   - `health_score` → compute from SOC range + cycle estimate
3. Wire `signalLogReader` into each handler

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "battery_snapshots" --include="*.go" internal/api/battery_degradation_handler.go internal/api/range_projection_handler.go internal/api/trip_planner_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero battery_snapshots refs in these 3 files.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/14b-battery-handlers: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/14b-battery-handlers` as the commit message prefix.

