---
description: "Phase-16 — Remove dead snapshot dispatch code"
---
# Prompt 02 — Remove Dead Snapshot Dispatch (trackMedia, trackVehicleConfig, callbacks)
> **Severity:** Cleanup | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-02-dead-dispatch.log` |
| Allowed files to change | `internal/api/telemetry_handler.go`, `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Three locations have no-op comment stubs where real code used to dispatch signals
to now-dropped snapshot tables. The dispatch functions and their callers should
be deleted entirely — the signal data is already written to signal_log via the
main write path.

## Task

### 1. telemetry_handler.go — delete `trackMedia` function

Around line 1700-1718: the function builds a `MediaSnapshot` struct then has a
no-op comment. Delete the ENTIRE function body or the function itself.

Also find and delete the CALLER — somewhere in telemetry_handler.go there's a
`h.trackMedia(ctx, vehicleID, signals)` call. Delete that call.

### 2. telemetry_handler.go — delete `trackVehicleConfig` function

Around line 1721-1827: the function builds a `VehicleConfigSnapshot` struct then
has a no-op comment. Delete the ENTIRE function or gut it.

Also find and delete the CALLER.

### 3. telemetry_sessions.go — remove dead buffer callback wiring

Line 165: `// Telemetry repos removed — buffer callbacks are no-ops (data lands in signal_log).`

Find what this refers to — likely callback registrations for snapshot repos that
were removed. Clean up any remaining dead references.

### 4. Survey for other dead dispatch

Run a broad search for other no-op snapshot dispatch:
```bash
grep -rn "trackMedia\|trackVehicleConfig\|trackSafety\|trackClimate\|trackMotor\|trackLocation\|trackTirePressure\|trackUserPref" --include="*.go" internal/api/
```

Delete ALL functions that are no-ops (just comments or empty bodies). Keep functions
that actually write to signal_log or Redis.

### Constraints

- Only delete functions that are truly dead (no-op or comment-only bodies)
- DO NOT delete functions that still do real work (e.g., `trackUserPreferences`
  might still update `vehicle_units` table — check before deleting)
- The signal data flows through the main `signalStore.Update()` + `signalHistoryWriter.Append()`
  path — snapshot dispatch was a SECONDARY write that's no longer needed

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify no dead track* functions remain
grep -n "func.*trackMedia\|func.*trackVehicleConfig" --include="*.go" internal/api/telemetry_handler.go
# Should return 0 matches (functions deleted)
# Verify no no-op comments about removed snapshots
grep -n "no-op\|captured via signal_log\|no dedicated table" --include="*.go" internal/api/telemetry_handler.go
# Should return 0 matches
```

## Commit

```powershell
git add -A
git commit -m "phase-16/02-dead-dispatch: remove dead snapshot dispatch functions

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/02-dead-dispatch` as the commit message prefix.
