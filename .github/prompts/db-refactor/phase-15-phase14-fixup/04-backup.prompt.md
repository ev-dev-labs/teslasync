---
description: "Phase-15 — Remove battery_snapshots from backup table list"
---
# Prompt 04 — backup/processor: Remove Dropped Table from Backup List
> **Severity:** Cleanup | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-04-backup.log` |
| Allowed files to change | `internal/backup/processor.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Line 29: `"battery_snapshots"` appears in the backup table list. Table is dropped.

## Task

1. Remove `"battery_snapshots"` from the backup table list
2. While you're there, scan the entire list for any OTHER dropped tables:
   `motor_snapshots`, `climate_snapshots`, `location_snapshots`, `safety_snapshots`,
   `tire_pressure_snapshots`, `user_preference_snapshots`, `vehicle_meta_snapshots`,
   `vehicle_live_state`, `charging_telemetry`, `charge_telemetry_readings`,
   `drive_telemetry_readings`
3. Remove ALL dropped tables from the list
4. Ensure `signal_log` IS in the list (it replaced all snapshot tables)

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -n "battery_snapshots\|motor_snapshots\|climate_snapshots\|vehicle_live_state\|charging_telemetry\|drive_telemetry" internal/backup/processor.go
# Should return 0 matches
```

## Commit

```powershell
git add -A
git commit -m "phase-15/04-backup: remove dropped tables from backup list

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-15/04-backup` as the commit message prefix.
