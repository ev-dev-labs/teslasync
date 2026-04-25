---
description: "Phase-16 — Clean dead dispatch: trim trackVehicleConfig, delete trackMedia, remove buffer no-ops"
---
# Prompt 02 — Clean Dead Dispatch Code
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

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

Three blocks of dead code remain from the signal_log migration:

1. **`telemetry_handler.go` — `trackMedia()` (~lines 1645-1712)**
   Builds a `MediaSnapshot` struct and ends with a no-op comment.
   Has **zero side effects** — no database writes, no event publishing. Delete entirely.

2. **`telemetry_handler.go` — `trackVehicleConfig()` (~lines 1715-1826)**
   Builds a `VehicleConfigSnapshot` struct and ends with a no-op comment at line 1825.
   **HOWEVER**, lines 1784-1799 contain `swUpdateRepo.InsertIfChanged()` for firmware
   version tracking — this is a **real side effect** that MUST be preserved.

3. **`telemetry_sessions.go` ~line 165** — Buffer callbacks wired as no-ops.
   Dead callback wiring that should be removed.

## Task

### 1. Delete `trackMedia()` entirely

The function (lines ~1645-1712) has no side effects. Delete the entire function.
Also delete its call site (search for `trackMedia(` in the same file).

### 2. Trim `trackVehicleConfig()` — KEEP firmware tracking

**Do NOT delete the entire function.** Instead:

- **KEEP** the function signature and the early-return guard (lines ~1715-1726) that checks
  for configuration signals. Simplify the guard to only check for `"Version"` since that's
  the only signal that triggers a real side effect.
- **KEEP** the `Version` handling block (lines ~1784-1799) which calls
  `swUpdateRepo.InsertIfChanged(ctx, vehicleID, version, "installed")` in a background
  goroutine. This tracks firmware updates and MUST stay.
- **DELETE** the `VehicleConfigSnapshot` struct building (lines ~1731-1783, 1800-1824) —
  all the optional field population for CarType, Trim, ExteriorColor, RoofColor, WheelType,
  boolean fields, software update percentage fields, etc. These are now captured via signal_log.
- **DELETE** the no-op comment at line ~1825.

The resulting function should be ~15-20 lines: guard → check Version → call InsertIfChanged → return.

### 3. Remove dead buffer callback wiring

In `telemetry_sessions.go` around line 165, remove the no-op callback registrations.
Search for comments like "no-op" or "signal_log" near callback wiring.

### 4. Keep `trackUserPreferences()` as-is

`trackUserPreferences()` writes to `vehicle_units` which is still a live table. Do NOT touch it.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify trackMedia is gone:
Select-String -Path internal\api\telemetry_handler.go -Pattern "func.*trackMedia\b"
# Should return 0 matches

# Verify swUpdateRepo.InsertIfChanged still exists:
Select-String -Path internal\api\telemetry_handler.go -Pattern "swUpdateRepo.InsertIfChanged"
# Should return 1 match

# Verify no-op comments are gone:
Select-String -Path internal\api\telemetry_handler.go,internal\api\telemetry_sessions.go -Pattern "no dedicated table write needed|no-op"
# Should return 0 matches
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/02-dead-dispatch: delete trackMedia, trim trackVehicleConfig (keep firmware tracking), remove buffer no-ops

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/02-dead-dispatch` as the commit message prefix.
