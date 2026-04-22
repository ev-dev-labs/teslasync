---
description: "Phase 4 — Concatenate validated schema files into 000142_baseline_typed.up.sql with legacy-table DROP preludes"
---

# 🔵 Migration 01 — Assemble `000142_baseline_typed.up.sql`

> **Severity:** Architectural centerpiece | **Priority:** Critical | **Prompt #:** 2 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `migrations/000142_baseline_typed.up.sql` |
| Depends on | `00-snapshot-schema-files` |
| Blocks | `02-write-down-migration`, `03-validate-migration-on-fresh-db` |
| ADR refs | ADR-001, ADR-002, ADR-003, ADR-006, ADR-008 |
| Estimated effort | medium (~2-3 hours) |

## Single Goal

Produce `migrations/000142_baseline_typed.up.sql` by concatenating `migrations/_baseline_source/*.sql` in the binding dependency order, prefixed by `DROP … IF EXISTS … CASCADE` for every legacy object the new schema replaces.

## What's Being Established

After this migration applies on top of `000141`:
- Every legacy table the new schema replaces is dropped (CASCADE drops their FKs)
- Every legacy function moved to Go (per ADR-006) is dropped
- Every legacy MV converted to a CAGG is dropped
- All Phase 3 tables, hypertables, compression+retention policies, and CAGGs exist

## Recommendation

### Apply order (binding)

```
A. CREATE EXTENSION block          (00-extensions)
B. Legacy DROP block               (see "Legacy drops")
C. Trigger fn + core entities      (01 vehicles -> installs set_updated_at)
D. signal_catalog                  (09 — must precede 08 for FK)
E. Hot snapshot tables             (02, 03, 04, 05, 06, 07, 08, 10)
F. Drives / sessions / trips       (11, 12, 13)
G. Automations tree                (14, 15, 16, 17)
H. Alert + notifications           (18, 19, 20)
I. Tesla integration               (21, 22)
J. System tables                   (23 — closes deferred place_id FKs from 15+17)
K. CAGGs                           (24, 25, 26)
```

### Legacy DROP block (paste at top of section B)

```sql
-- ===== Legacy table drops (replaced by Phase 3) =====
DROP TABLE IF EXISTS climate_snapshots                CASCADE;
DROP TABLE IF EXISTS motor_snapshots                  CASCADE;
DROP TABLE IF EXISTS security_events                  CASCADE;
DROP TABLE IF EXISTS positions                        CASCADE;
DROP TABLE IF EXISTS charging_telemetry               CASCADE;
DROP TABLE IF EXISTS signal_observations              CASCADE;
DROP TABLE IF EXISTS signal_catalog                   CASCADE;
DROP TABLE IF EXISTS vehicle_live_state               CASCADE;
DROP TABLE IF EXISTS tire_pressure_snapshots          CASCADE;
DROP TABLE IF EXISTS media_snapshots                  CASCADE;
DROP TABLE IF EXISTS safety_snapshots                 CASCADE;
DROP TABLE IF EXISTS vehicle_config_snapshots         CASCADE;
DROP TABLE IF EXISTS user_preference_snapshots        CASCADE;
DROP TABLE IF EXISTS automations                      CASCADE;
DROP TABLE IF EXISTS alert_rules                      CASCADE;
DROP TABLE IF EXISTS notification_channels            CASCADE;
DROP TABLE IF EXISTS notifications                    CASCADE;
DROP TABLE IF EXISTS tesla_tokens                     CASCADE;
DROP TABLE IF EXISTS api_call_logs                    CASCADE;
DROP TABLE IF EXISTS vehicles                         CASCADE;
DROP TABLE IF EXISTS drives                           CASCADE;
DROP TABLE IF EXISTS charging_sessions                CASCADE;
DROP TABLE IF EXISTS trips                            CASCADE;
DROP TABLE IF EXISTS trip_drives                      CASCADE;
DROP TABLE IF EXISTS places                           CASCADE;
DROP TABLE IF EXISTS geofences                        CASCADE;
DROP TABLE IF EXISTS electricity_cost                 CASCADE;
DROP TABLE IF EXISTS gas_prices                       CASCADE;
DROP TABLE IF EXISTS settings                         CASCADE;
DROP TABLE IF EXISTS polling_config                   CASCADE;
DROP TABLE IF EXISTS audit_logs                       CASCADE;
DROP TABLE IF EXISTS command_executions               CASCADE;
DROP TABLE IF EXISTS fsm_transitions                  CASCADE;
DROP TABLE IF EXISTS embeddings                       CASCADE;

-- ===== Legacy function drops (per ADR-006) =====
DROP FUNCTION IF EXISTS fn_drive_score_breakdown          (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_drive_efficiency               (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_drive_segment_summary          (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_charging_session_total         (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_charging_session_efficiency    (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_battery_degradation_estimate   (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_tco_summary                    (bigint, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS fn_speed_profile                  (bigint, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS fn_route_efficiency               (bigint, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS fn_temperature_impact             (bigint, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS fn_charging_calendar_heatmap      (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_charging_hourly_distribution   (bigint) CASCADE;
DROP FUNCTION IF EXISTS fn_charging_power_timeline        (bigint) CASCADE;

-- ===== Legacy materialized view drops (per ADR-006) =====
DROP MATERIALIZED VIEW IF EXISTS mv_position_hourly  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_energy_daily     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_signal_stats     CASCADE;
```

Adjust function-signature parameter lists to match what actually exists in production (`\df fn_*` from prod gives canonical signatures).

### Concatenation tooling

```powershell
$order = @(
  '00-extensions','01-vehicles','09-signal-catalog',
  '02-vehicle-live-state','03-positions-hypertable','04-charging-telemetry-hypertable',
  '05-climate-snapshots-hypertable','06-motor-snapshots-hypertable','07-security-events-hypertable',
  '08-signal-observations-hypertable','10-vehicle-meta-snapshots-hypertable',
  '11-drives','12-charging-sessions','13-trips',
  '14-automations-parent','15-automation-conditions','16-automation-actions','17-automation-step-children',
  '18-alert-rules','19-notification-channels','20-notifications',
  '21-tesla-tokens','22-api-call-logs','23-system-tables',
  '24-caggs-fleet-stats','25-caggs-charging-summary','26-caggs-signal-hourly'
)
$out = 'D:\repos\teslasync\migrations\000142_baseline_typed.up.sql'
'-- Auto-assembled by phase-4-migration/01. Do not edit by hand.' | Set-Content $out
'-- Source snapshots: migrations/_baseline_source/'                | Add-Content $out
''                                                                  | Add-Content $out
# (Append the legacy DROP block here from this prompt.)
foreach ($name in $order) {
  $src = Get-ChildItem D:\repos\teslasync\migrations\_baseline_source\ -Filter "$name.sql" | Select-Object -First 1
  if (-not $src) { throw "Missing snapshot: $name.sql" }
  "-- ===== source: $($src.Name) =====" | Add-Content $out
  Get-Content $src.FullName -Raw | Add-Content $out
  '' | Add-Content $out
}
```

## Suggested Fix

1. Run the assembly loop
2. Inspect output line count (should ≈ sum of inputs + small overhead)
3. Apply against fresh `ts-schema-validate` to confirm assembled file works as a single statement stream
4. Commit

## Acceptance Criteria

- [ ] `migrations/000142_baseline_typed.up.sql` exists
- [ ] First statements after legacy-DROP block are `CREATE EXTENSION`
- [ ] Last statements are `add_continuous_aggregate_policy(...)`
- [ ] No `IF NOT EXISTS` on `CREATE TABLE`/`CREATE TYPE` (only on `CREATE EXTENSION`)
- [ ] Apply on fresh DB succeeds with `ON_ERROR_STOP=1`
- [ ] Final DB has zero-jsonb except `automation_actions.command_params`
- [ ] All hypertable + retention + compression + CAGG policies registered
- [ ] Committed

## Verification

```powershell
docker rm -f ts-schema-validate 2>$null
docker run -d --name ts-schema-validate -e POSTGRES_PASSWORD=p `
  -p 5499:5432 timescale/timescaledb-ha:pg17
Start-Sleep 8
docker exec ts-schema-validate psql -U postgres -c "CREATE DATABASE v;"

Get-Content D:\repos\teslasync\migrations\000142_baseline_typed.up.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT table_name, column_name FROM information_schema.columns WHERE data_type='jsonb' AND table_schema='public';"
# Expected: 1 row — automation_actions | command_params

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM timescaledb_information.hypertables;"
# Expected: 7

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM timescaledb_information.continuous_aggregates;"
# Expected: 3
```

## Out of Scope

- Don't drop the legacy 141 migrations (additive, ADR-008).
- Don't add data migration here (Phase 11 cutover; staging soak accepts data loss per ADR-009).
- Don't reorder the apply sections — FK-closure ALTERs depend on this order.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add migrations/000142_baseline_typed.up.sql
git commit -m "migrations: add 000142_baseline_typed.up.sql

Forward-only baseline assembled from migrations/_baseline_source/.
Validates against fresh ts-ha:pg17: zero-jsonb except
automation_actions.command_params, 7 hypertables, 3 CAGGs, all
compression+retention policies registered.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-001, ADR-006, ADR-008
- `phase-3-schema/README.md`
- `migrations/_baseline_source/`
