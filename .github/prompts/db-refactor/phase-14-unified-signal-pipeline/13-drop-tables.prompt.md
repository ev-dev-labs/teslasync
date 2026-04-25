---
description: "Phase-14 — Drop snapshot tables from database schema"
---
# Prompt 13 — Drop Legacy Tables (migration)
> **Severity:** Schema | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-13-drop-tables.log` |
| Allowed files to change | `internal/database/migrations/` (new up+down), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 12 (no code references to these tables)

## Tables to DROP

```sql
DROP TABLE IF EXISTS motor_snapshots CASCADE;
DROP TABLE IF EXISTS climate_snapshots CASCADE;
DROP TABLE IF EXISTS location_snapshots CASCADE;
DROP TABLE IF EXISTS safety_snapshots CASCADE;
DROP TABLE IF EXISTS battery_snapshots CASCADE;
DROP TABLE IF EXISTS tire_pressure_snapshots CASCADE;
DROP TABLE IF EXISTS user_preference_snapshots CASCADE;
DROP TABLE IF EXISTS vehicle_meta_snapshots CASCADE;
DROP TABLE IF EXISTS vehicle_live_state CASCADE;
DROP TABLE IF EXISTS charging_telemetry CASCADE;
DROP TABLE IF EXISTS charge_telemetry_readings CASCADE;
DROP TABLE IF EXISTS drive_telemetry_readings CASCADE;
```

## Task

### 1. Create migration UP

Drop all 12 tables listed above with CASCADE (handles foreign keys).

### 2. Create migration DOWN

Recreate all 12 tables with their original schemas. Check existing migrations
for the CREATE TABLE statements. This is the safety net for rollback.

### Constraints

- **Fresh start** — no data to preserve. These tables are being permanently removed.
- Use `IF EXISTS` to make idempotent
- CASCADE handles any foreign key constraints
- Tables NOT dropped: `signal_log`, `drives`, `charging_sessions`, `vehicle_states`,
  `vehicles`, `positions`, `settings`, `geofences`, `automations`, `notifications`, etc.

## Gate

```powershell
cd D:\repos\teslasync
# Apply migration
docker exec -i teslasync-postgres psql -U teslasync -d teslasync < internal/database/migrations/XXXXXX_drop_snapshot_tables.up.sql
# Verify tables are gone
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%snapshot%' ORDER BY 1;"
# Should return 0 rows
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = 'vehicle_live_state';"
# Should return 0 rows
```

Log result. STATUS=DONE only if all tables dropped successfully.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/13-drop-tables: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/13-drop-tables` as the commit message prefix.

