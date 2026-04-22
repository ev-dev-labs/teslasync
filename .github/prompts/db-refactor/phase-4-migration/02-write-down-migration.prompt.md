---
description: "Phase 4 — Write 000142_baseline_typed.down.sql that drops every new object in reverse dependency order"
---

# 🟢 Migration 02 — Write `000142_baseline_typed.down.sql`

> **Severity:** Standard | **Priority:** High (golang-migrate requires `.down.sql`) | **Prompt #:** 3 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `migrations/000142_baseline_typed.down.sql` |
| Depends on | `01-assemble-up-migration` |
| Blocks | `03-validate-migration-on-fresh-db` |
| ADR refs | ADR-008 |
| Estimated effort | small (~30 min) |

## Single Goal

Produce `migrations/000142_baseline_typed.down.sql` that drops every object created by the up migration, in reverse dependency order. Per ADR-008 this is **NOT a restore** of the legacy schema — it just leaves the DB at "post-141, no 142". A subsequent `migrate up` re-applies 142.

## What's Being Established

`golang-migrate` requires a `.down.sql` per `.up.sql`. Phase 4 is additive — the down here doesn't recreate `mv_energy_daily` or the dropped legacy functions. Real production rollback restores PG from backup (Phase 11 / `rollback/99-rollback`), not via `migrate down`.

## Recommendation

### Drop order (reverse of up)

```
1. CAGGs (26, 25, 24)
2. system tables (23 — places CASCADE drops automation FKs)
3. tesla integration (22, 21)
4. notifications stack (20, 19 + 7 channel subtypes, 18)
5. automations tree (17 + 7 step children, 16, 15 + 4 condition children, 14)
6. drives/sessions/trips (13 + trip_drives, 12, 11)
7. hot snapshot hypertables (10, 08, 07, 06, 05, 04, 03, 02)
8. signal_catalog (09)
9. vehicles (01)
10. set_updated_at() function
11. extensions intentionally retained
```

### Output (full file)

```sql
-- =========================================================================
-- 000142 down — drops every object the up created.
-- ADR-008: this is NOT a restore of legacy schema. Production rollback
-- restores from PG backup (rollback/99-rollback.prompt.md).
-- =========================================================================

-- CAGGs
DROP MATERIALIZED VIEW IF EXISTS cagg_signal_hourly        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_charging_summary     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_fleet_stats          CASCADE;

-- system tables (places CASCADE drops the closed FKs)
DROP TABLE IF EXISTS embeddings              CASCADE;
DROP TABLE IF EXISTS fsm_transitions         CASCADE;
DROP TABLE IF EXISTS command_executions      CASCADE;
DROP TABLE IF EXISTS audit_logs              CASCADE;
DROP TABLE IF EXISTS gas_prices              CASCADE;
DROP TABLE IF EXISTS electricity_cost        CASCADE;
DROP TABLE IF EXISTS geofences               CASCADE;
DROP TABLE IF EXISTS places                  CASCADE;
DROP TABLE IF EXISTS polling_config          CASCADE;
DROP TABLE IF EXISTS settings                CASCADE;

-- tesla
DROP TABLE IF EXISTS api_call_logs           CASCADE;
DROP TABLE IF EXISTS tesla_tokens            CASCADE;

-- notifications
DROP TABLE IF EXISTS notifications                       CASCADE;
DROP TABLE IF EXISTS notification_channel_pushover       CASCADE;
DROP TABLE IF EXISTS notification_channel_ntfy           CASCADE;
DROP TABLE IF EXISTS notification_channel_webhook        CASCADE;
DROP TABLE IF EXISTS notification_channel_email          CASCADE;
DROP TABLE IF EXISTS notification_channel_telegram       CASCADE;
DROP TABLE IF EXISTS notification_channel_slack          CASCADE;
DROP TABLE IF EXISTS notification_channel_discord        CASCADE;
DROP TABLE IF EXISTS notification_channels               CASCADE;
DROP TABLE IF EXISTS alert_rules                         CASCADE;

-- automations tree (children before parent)
DROP TABLE IF EXISTS automation_step_action_call_automation  CASCADE;
DROP TABLE IF EXISTS automation_step_action_set_setting      CASCADE;
DROP TABLE IF EXISTS automation_step_action_notify           CASCADE;
DROP TABLE IF EXISTS automation_step_action_command          CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_event           CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_schedule        CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_geofence        CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_signal          CASCADE;
DROP TABLE IF EXISTS automation_step_condition_other         CASCADE;
DROP TABLE IF EXISTS automation_step_condition_geofence      CASCADE;
DROP TABLE IF EXISTS automation_step_condition_time_window   CASCADE;
DROP TABLE IF EXISTS automation_step_condition_signal        CASCADE;
DROP TABLE IF EXISTS automation_steps                        CASCADE;
DROP TABLE IF EXISTS automation_tags                         CASCADE;
DROP TABLE IF EXISTS automations                             CASCADE;
DROP TYPE  IF EXISTS automation_step_kind                    CASCADE;

-- drives / sessions / trips
DROP TABLE IF EXISTS trip_drives             CASCADE;
DROP TABLE IF EXISTS trips                   CASCADE;
DROP TABLE IF EXISTS charging_sessions       CASCADE;
DROP TABLE IF EXISTS drives                  CASCADE;

-- hot snapshot hypertables
DROP TABLE IF EXISTS vehicle_meta_snapshots  CASCADE;
DROP TABLE IF EXISTS signal_observations     CASCADE;
DROP TABLE IF EXISTS security_events         CASCADE;
DROP TABLE IF EXISTS motor_snapshots         CASCADE;
DROP TABLE IF EXISTS climate_snapshots       CASCADE;
DROP TABLE IF EXISTS charging_telemetry      CASCADE;
DROP TABLE IF EXISTS positions               CASCADE;
DROP TABLE IF EXISTS vehicle_live_state      CASCADE;

-- catalog + entity
DROP TABLE IF EXISTS signal_catalog          CASCADE;
DROP TABLE IF EXISTS vehicles                CASCADE;

-- shared trigger function
DROP FUNCTION IF EXISTS set_updated_at()     CASCADE;

-- NOTE: extensions intentionally retained.
```

## Suggested Fix

1. Inspect the up migration to confirm full list of created objects (every `CREATE TABLE`, `CREATE TYPE`, `CREATE MATERIALIZED VIEW`, `CREATE FUNCTION`)
2. Reverse the order
3. Add explicit DROPs for every CTI child table
4. Apply over a freshly-applied up to confirm idempotency (up → down → up cycle works)

## Acceptance Criteria

- [ ] `migrations/000142_baseline_typed.down.sql` exists
- [ ] All 3 CAGGs dropped
- [ ] All 7 hypertables dropped
- [ ] All 13 automation_step_* + parent tables + enum type dropped
- [ ] All 7 notification_channel_* + parent + alert_rules + notifications dropped
- [ ] `set_updated_at()` dropped
- [ ] Extensions NOT dropped
- [ ] up → down → up cycle succeeds on fresh DB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\migrations\000142_baseline_typed.up.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

Get-Content D:\repos\teslasync\migrations\000142_baseline_typed.down.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# After down: 0 hypertables, 0 CAGGs
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT (SELECT count(*) FROM timescaledb_information.hypertables) AS ht, (SELECT count(*) FROM timescaledb_information.continuous_aggregates) AS cagg;"
# Expected: ht=0, cagg=0

# Re-apply up
Get-Content D:\repos\teslasync\migrations\000142_baseline_typed.up.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1
```

## Out of Scope

- Don't restore legacy schema (5 dropped snapshot tables, 10 dropped fns, 3 dropped MVs).
- Don't `DROP EXTENSION timescaledb`.
- Don't drop `migrations/_baseline_source/`.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add migrations/000142_baseline_typed.down.sql
git commit -m "migrations: add 000142_baseline_typed.down.sql

Drops every object 142.up created, reverse dependency order.
Per ADR-008: down does NOT restore legacy schema. Production rollback
uses pg_restore from backup (rollback/99-rollback). Extensions retained.

up -> down -> up cycle validated on fresh ts-ha:pg17.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-008
- `rollback/99-rollback.prompt.md`
