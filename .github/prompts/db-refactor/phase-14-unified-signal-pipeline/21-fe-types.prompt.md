---
description: "Phase-14 — Frontend types update for dropped tables"
---
# Prompt 21 — Frontend Types: Remove Dropped Table Interfaces, Update API Types
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-21-fe-types.log` |
| Allowed files to change | `web/src/api/types.ts`, `web/src/types/*.ts`, frontend page/hook files, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 14 (handlers rewired), 18 (SSE rewired)

## Problem

Frontend TypeScript interfaces reference data shapes from dropped tables:
- `VehicleLiveState` — mapped to `vehicle_live_state` table (dropped)
- `MotorSnapshot`, `ClimateSnapshot`, etc. — interfaces for snapshot table rows
- `ChargingTelemetry`, `DriveTelemetryReading` — interfaces for telemetry tables
- API hooks that fetch from endpoints backed by these tables

After the backend handlers are rewired (prompt 14), the API response shapes may change.
The frontend types must match.

## Task

### 1. Survey existing interfaces

```bash
grep -rn "VehicleLiveState\|MotorSnapshot\|ClimateSnapshot\|SecuritySnapshot\|TirePressureSnapshot\|LocationSnapshot\|SafetySnapshot\|UserPreferenceSnapshot\|VehicleConfigSnapshot\|ChargingTelemetry\|DriveTelemetryReading" --include="*.ts" --include="*.tsx" web/src/
```

### 2. For each interface

**If the backend endpoint STILL returns the same shape** (handler rewired but keeps
same JSON keys for backward compatibility — as specified in prompt 14):
→ Keep the interface, no change needed.

**If the backend endpoint response shape changed:**
→ Update the interface to match the new shape.

**If the endpoint was removed entirely:**
→ Delete the interface and all hooks/pages that use it, OR rewire the hook to
call the replacement endpoint.

### 3. Update `VehicleLiveState` specifically

The `/api/v1/vehicles/{id}/live-state` endpoint previously returned columns from
`vehicle_live_state` table. It should now return data from Redis HSET.

Check if the handler was rewired in prompt 14. If so, verify the response shape:

```bash
curl -s http://localhost:8080/api/v1/vehicles/1/live-state | python -m json.tool
```

Update the `VehicleLiveState` TypeScript interface to match.

### 4. Update SSE `vehicle_update` event type

If the SSE payload shape changed in prompt 18, update the frontend SSE handler
type to match.

### Constraints

- **Run tsc after every file change** — catch type errors immediately
- If an interface is used in 10+ files, update the interface definition,
  not the 10 consumers
- `VehicleState` (from `/api/v1/vehicles/{id}/state`) is NOT affected — that
  endpoint reads from the signal store, not vehicle_live_state
- Keep `TirePressureSnapshot`, `MotorSnapshot` etc. if the API still returns
  those shapes (just backed by signal_log instead of snapshot tables)

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Verify no references to deleted backend types
grep -rn "VehicleLiveState" --include="*.ts" --include="*.tsx" src/ | head -10
# Check if still used and whether the interface matches the API response
```

Log result. STATUS=DONE only if tsc passes with zero type errors.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/21-fe-types: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/21-fe-types` as the commit message prefix.

