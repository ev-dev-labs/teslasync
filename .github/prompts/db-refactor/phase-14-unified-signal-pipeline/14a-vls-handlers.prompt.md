---
description: "Phase-14 — Rewire handlers reading vehicle_live_state → Redis"
---
# Prompt 14a — Rewire vehicle_live_state Readers → Redis
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-14a-vls-handlers.log` |
| Allowed files to change | `maintenance_handler.go`, `signal_handler.go`, `watch_handler.go`, `command_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 02 (Redis HSET write), 03 (Redis read)

## Exactly 4 handlers to fix

| Handler | Query | Replacement |
|---|---|---|
| `maintenance_handler.go` | `FROM vehicle_live_state WHERE vehicle_id` | `redisCache.GetAll(ctx, vehicleID)` |
| `signal_handler.go` | `FROM vehicle_live_state WHERE vehicle_id` | `redisCache.GetAll(ctx, vehicleID)` |
| `watch_handler.go:232` | `FROM vehicle_live_state` | `redisCache.GetAll(ctx, vehicleID)` |
| `command_handler.go` | reads vehicle_live_state for wake status | `redisCache.GetSignal(ctx, vehicleID, "ShiftState")` |

## Task

For each handler:
1. Replace the SQL query with a Redis `GetAll()` or `GetSignal()` call
2. Map the Redis response keys to the fields the handler expects
3. Wire `redisSignalCache` into the handler struct

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "vehicle_live_state" --include="*.go" internal/api/maintenance_handler.go internal/api/signal_handler.go internal/api/watch_handler.go internal/api/command_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero vehicle_live_state refs in these 4 files.
