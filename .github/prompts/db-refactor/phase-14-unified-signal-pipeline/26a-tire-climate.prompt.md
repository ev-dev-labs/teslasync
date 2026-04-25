---
description: "Phase-14 — Rewire tire-pressure + climate endpoints → signal_log"
---
# Prompt 26a — Tire Pressure + Climate Endpoints → signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-26a-tire-climate.log` |
| Allowed files to change | `internal/api/tire_pressure_handler.go`, `internal/api/climate_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SnapshotAt), 23 (SignalTracePivot)

## Exactly 2 handlers, 4 endpoints

### 1. Tire Pressure Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /tire-pressure` (history) | `FROM tire_pressure_snapshots` | `SignalTracePivotFlat` with TPMS signals |
| `GET /tire-pressure/latest` | Latest row from snapshots | `SnapshotAt(now)` for TPMS signals |

Signal mappings:
```go
var tirePressureMappings = []database.SignalMapping{
    {Signal: "TpmsPressureFl", Field: "front_left"},
    {Signal: "TpmsPressureFr", Field: "front_right"},
    {Signal: "TpmsPressureRl", Field: "rear_left"},
    {Signal: "TpmsPressureRr", Field: "rear_right"},
    {Signal: "TpmsLastSeenPressureTimeFl", Field: "last_seen_fl"},
    {Signal: "TpmsLastSeenPressureTimeFr", Field: "last_seen_fr"},
    {Signal: "TpmsLastSeenPressureTimeRl", Field: "last_seen_rl"},
    {Signal: "TpmsLastSeenPressureTimeRr", Field: "last_seen_rr"},
}
```

### 2. Climate Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /climate` (history) | `FROM climate_snapshots` | `SignalTracePivotFlat` with climate signals |
| `GET /climate/latest` | Latest row from snapshots | `SnapshotAt(now)` for climate signals |

Signal mappings:
```go
var climateMappings = []database.SignalMapping{
    {Signal: "InsideTemp", Field: "inside_temp_c"},
    {Signal: "OutsideTemp", Field: "outside_temp_c"},
    {Signal: "HvacPower", Field: "hvac_state"},
    {Signal: "DefrostMode", Field: "defrost_mode"},
}
```

### Constraints

- API response shape must match what frontend expects
- Wire `signalLogReader` into both handlers
- For `/latest` endpoints, can use Redis `GetAll()` for lower latency as alternative

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "tire_pressure_snapshot\|climate_snapshot" --include="*.go" internal/api/tire_pressure_handler.go internal/api/climate_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero snapshot refs in these 2 files.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/26a-tire-climate: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/26a-tire-climate` as the commit message prefix.

