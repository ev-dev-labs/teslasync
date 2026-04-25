---
description: "Phase-14 — Drop snapshot writer code (repos + dispatch)"
---
# Prompt 12 — Remove Snapshot Writer Code
> **Severity:** Cleanup | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-12-drop-writers.log` |
| Allowed files to change | Files listed in the table below, `internal/api/telemetry_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 09, 10 (session completion no longer needs snapshot data)

## Files to DELETE

| File | What it wrote to |
|---|---|
| `internal/database/motor_repo.go` | motor_snapshots |
| `internal/database/climate_repo.go` | climate_snapshots |
| `internal/database/location_snapshot_repo.go` | location_snapshots |
| `internal/database/safety_repo.go` | safety_snapshots (if exists) |
| `internal/database/tire_pressure_repo.go` | tire_pressure_snapshots |
| `internal/database/user_preference_repo.go` | user_preference_snapshots |
| `internal/database/vehicle_meta_repo.go` | vehicle_meta_snapshots |
| `internal/database/vehicle_live_state_repo.go` | vehicle_live_state |
| `internal/database/live_state_repo.go` | vehicle_live_state (flush) |
| `internal/database/live_state_repo_test.go` | tests for above |
| `internal/database/charging_telemetry_repo.go` | charging_telemetry |
| `internal/database/charge_telemetry_repo.go` | charge_telemetry_readings |
| `internal/database/drive_telemetry_repo.go` | drive_telemetry_readings |
| `internal/telemetry/hot_catalog_motor.go` | motor dispatch |
| `internal/telemetry/hot_catalog_climate.go` | climate dispatch |
| `internal/telemetry/hot_catalog_charging.go` | charging telemetry dispatch |
| `internal/telemetry/hot_catalog_vehicle_live_state.go` | live state dispatch |
| `internal/models/vehicle_live_state.go` | model struct |
| `internal/models/motor.go` | model struct |
| `internal/models/climate.go` | model struct |
| `internal/models/charging_telemetry.go` | model struct |
| `internal/models/vehicle_meta.go` | model struct |

## Task

### 1. Survey each file — confirm it's ONLY used for snapshot writes

Before deleting, grep for each repo/model type across the codebase to find all
consumers. If a handler READS from a snapshot table (not just writes), that handler
needs to be rewired first (prompt 14).

### 2. Remove dispatch paths in `telemetry_handler.go`

The handler dispatches signals to each snapshot writer. Remove those dispatch
blocks. The only remaining dispatch paths should be:
- `signalStore.Update()` — in-memory (kept until Redis fully replaces it)
- `redisSignalCache.Update()` — Redis HSET
- `signalHistoryWriter.Append()` — signal_log

### 3. Remove FlushLoop from signal.Store

`store.go` has `FlushLoop()` that writes to `vehicle_live_state`. Remove:
- `FlushLoop()` method
- `flushDirty()` method
- `FlushAll()` method (shutdown flush)
- `WaitForFlushLoop()` method
- The `Flusher` interface (no longer needed)
- The `dirty` map and `flushWg` WaitGroup

### 4. Fix compilation

After deleting files, fix any imports and references. Other files that reference
deleted repos/models will need their imports removed. Compilation must pass.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify no references to deleted repos remain
grep -rn "motor_repo\|climate_repo\|safety_repo\|tire_pressure_repo\|user_preference_repo\|vehicle_meta_repo\|vehicle_live_state_repo\|live_state_repo\|drive_telemetry_repo\|charge_telemetry_repo\|charging_telemetry_repo" --include="*.go" internal/ | grep -v "_test.go\|signal_log\|signal_history" | head -20
# Should return 0 matches (all deleted)
```

Log result. STATUS=DONE only if build passes AND grep returns 0 refs to deleted repos.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/12-drop-writers: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/12-drop-writers` as the commit message prefix.

