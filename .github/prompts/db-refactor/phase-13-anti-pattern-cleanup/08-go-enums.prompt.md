---
description: "Phase-13 — Standardize enum state strings via enums package"
---
# Prompt 08 — Standardize Enum State Strings (use enums package everywhere)
> **Severity:** MEDIUM | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-08-go-enums.log` |
| Allowed files to change | `internal/enums/*.go` (extend), handler/worker files with string literals, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Vehicle states (`"parked"`, `"driving"`, `"charging"`, `"asleep"`, `"online"`, `"offline"`)
and charging states (`"Disconnected"`, `"Connected"`, `"Charging"`, `"Complete"`) appear as
string literals across handlers and workers. The `internal/enums/` package exists but isn't
used consistently.

## Task

### 1. Survey the enums package

Check `internal/enums/` for existing state constants. If vehicle state constants don't exist:

```go
// internal/enums/vehicle_state.go
package enums

const (
    StateOnline   = "online"
    StateDriving  = "driving"
    StateCharging = "charging"
    StateParked   = "parked"
    StateAsleep   = "asleep"
    StateOffline  = "offline"
    StateUpdating = "updating"
)

const (
    ChargingDisconnected = "Disconnected"
    ChargingConnected    = "Connected"
    ChargingCharging     = "Charging"
    ChargingStopped      = "Stopped"
    ChargingComplete     = "Complete"
    ChargingNoPower      = "NoPower"
    ChargingStarting     = "Starting"
)
```

### 2. Replace string literals with enum constants

Survey with:
```bash
grep -rn '"parked"\|"driving"\|"charging"\|"asleep"\|"online"\|"offline"' --include="*.go" internal/
```

For each match in non-test, non-migration files:
- Replace `"parked"` with `enums.StateParked`
- Replace `"charging"` with `enums.StateCharging`
- etc.

**Skip:**
- Test files (`_test.go`) — string literals in tests are fine
- Migration files (`.sql`) — SQL strings stay as-is
- JSON struct tags — `json:"state"` stays
- FSM transition trigger names — `"TriggerChargeStarted"` is a trigger, not a state enum
- Log messages — `Msg("vehicle is parked")` stays as-is

### Important constraints

- **Do NOT rename any values** — `"parked"` stays `"parked"`, just referenced via constant
- Only replace vehicle/charging state comparisons (e.g., `if state == "parked"`)
- The `automation/presets/` JSON has hardcoded `"state":"parked"` — that's JSON data, not Go code. Leave it.
- Be conservative — if unsure whether a string is a state enum or something else, leave it

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
# Count remaining bare state literals in non-test Go files (excluding tests, migrations, JSON)
grep -rn '"parked"\|"driving"\|"asleep"' --include="*.go" internal/ | grep -v "_test.go\|migrations\|presets\|\.json\|Msg(" | wc -l
# Report count (may not be 0 — some may be in struct literals or switch cases that are fine)
```

Log result. STATUS=DONE only if build+vet pass.
