---
description: "Phase-14 — FSM + Automation engine read from Redis"
---
# Prompt 19 — FSM + Automation Engine: Read from Redis instead of vehicle_live_state
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-19-fsm-auto-redis.log` |
| Allowed files to change | `internal/api/fsm_handler.go`, `internal/fsm/*.go`, `internal/automation/*.go`, `internal/database/automation_repo.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 03 (Redis read path)

## Problem

### FSM engine
The vehicle FSM (`internal/fsm/`) evaluates triggers based on signal values
(speed, gear, battery level, charging state). Currently reads from the in-memory
`signal.Store`. After the refactor, the in-memory store is still populated (kept
as hot cache), BUT on pod restart it loads from Redis (prompt 03). So the FSM
should keep reading from the in-memory store — **no change needed for FSM**.

### Automation engine
The automation condition evaluator (`internal/automation/` and `internal/database/automation_repo.go`)
checks conditions like "if battery_level < 20" or "if speed > 80". It currently reads
from `vehicle_live_state` table via SQL queries. That table is being dropped (prompt 13).

## Task

### 1. Survey automation condition evaluation

```bash
grep -rn "vehicle_live_state\|battery_level\|speed_mph\|is_locked\|sentry_mode\|is_charging" --include="*.go" internal/automation/ internal/database/automation_repo.go
```

Find where automation conditions query `vehicle_live_state`.

### 2. Replace vehicle_live_state queries with Redis reads

For real-time condition checks (e.g., "if battery_level < 20 right now"):

```go
// Before:
row := db.QueryRow("SELECT battery_level FROM vehicle_live_state WHERE vehicle_id = $1", vehicleID)

// After:
val, err := redisSignalCache.GetSignal(ctx, vehicleID, "BatteryLevel")
batteryLevel := toFloat(val)
```

For conditions that check the in-memory signal store (if automation engine already
reads from `signal.Store`), no change needed — the store is still populated.

### 3. Verify FSM reads

Confirm the FSM reads from `signal.Store.Get()` or `signal.Store.GetAll()`, NOT
from `vehicle_live_state` table. If it reads from DB, rewire to Redis.

```bash
grep -rn "vehicle_live_state\|LiveState" --include="*.go" internal/fsm/
```

### Constraints

- **In-memory signal store stays** as the hot path for FSM (sub-ms reads)
- Automation engine may need both in-memory reads (for real-time) and signal_log
  reads (for "was battery below 20% in the last hour?" type conditions)
- Wire `redisSignalCache` into automation engine if it queries DB for live state
- If automation conditions only use the in-memory signal store, this prompt is trivial

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify no vehicle_live_state references in automation or FSM code
grep -rn "vehicle_live_state" --include="*.go" internal/automation/ internal/fsm/ internal/database/automation_repo.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero vehicle_live_state refs in automation/FSM.
