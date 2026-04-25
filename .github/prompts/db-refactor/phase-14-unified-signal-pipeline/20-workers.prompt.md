---
description: "Phase-14 — Rewire export/backup workers for signal_log"
---
# Prompt 20 — Export + Backup Workers: Read from signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-20-workers.log` |
| Allowed files to change | `internal/export/processor.go`, `internal/backup/processor.go`, `internal/worker/maintenance_worker.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 12-13 (snapshot code/tables removed)

## Problem

### Export worker
`internal/export/processor.go` exports data from various tables. It references
snapshot tables that no longer exist. Exports of telemetry data should query
`signal_log` instead.

### Backup worker
`internal/backup/processor.go` backs up tables. Remove references to dropped tables.
Add `signal_log` to the backup list.

### Maintenance worker
`internal/worker/maintenance_worker.go` runs compression, cleanup on snapshot tables.
Remove those tasks. May already handle signal_log TTL cleanup — verify.

## Task

### 1. Survey export processor

```bash
grep -rn "motor_snapshot\|climate_snapshot\|tire_pressure\|charging_telemetry\|drive_telemetry\|vehicle_live_state\|location_snapshot\|safety_snapshot" --include="*.go" internal/export/
```

For each reference:
- If exporting snapshot data → replace with signal_log query using SignalTrace
- If exporting drive/charge data → those tables stay, no change needed

### 2. Survey backup processor

```bash
grep -rn "motor_snapshot\|climate_snapshot\|tire_pressure\|charging_telemetry\|drive_telemetry\|vehicle_live_state" --include="*.go" internal/backup/
```

Remove dropped tables from backup table list. Add `signal_log` if not already there.

### 3. Survey maintenance worker

```bash
grep -rn "motor_snapshot\|climate_snapshot\|tire_pressure\|charging_telemetry\|drive_telemetry\|vehicle_live_state\|VACUUM\|compression" --include="*.go" internal/worker/maintenance_worker.go
```

Remove maintenance tasks for dropped tables. The signal_log hypertable has
automatic compression via TimescaleDB policy (prompt 00) — no manual compression needed.
Keep the existing signal_log TTL cleanup if it exists.

### Constraints

- **Export format should stay compatible** — if users exported "motor data" before,
  now export the same signals from signal_log with the same column headers
- Backup of signal_log may need special handling for hypertables — use `pg_dump` with
  TimescaleDB extension or `timescaledb-backup` tool
- If a worker file has no refs to dropped tables, mark as no-change-needed in the log

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify no refs to dropped tables in workers
grep -rn "motor_snapshot\|climate_snapshot\|vehicle_live_state\|charging_telemetry\|drive_telemetry" --include="*.go" internal/export/ internal/backup/ internal/worker/
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero dropped-table refs.
