# 02 — Assemble Baseline Migration

**Phase:** 5
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`
**Pre-req:** Phase 3 schema files exist and validate
**Output:** `migrations/000142_baseline_typed.up.sql` + `.down.sql`
**Estimated effort:** half day

---

## Goal

Concatenate the 12 `schema/*.sql` files into ONE migration file pair, in the correct dependency order, that applies cleanly on top of the existing 141 migrations.

**Important:** This baseline is **additive** — it does NOT delete the 141 prior migrations. Per ADR-008, migration squash is deferred to Program C on a future branch.

## Order of concatenation (binding)

```
01-extensions.sql                      → CREATE EXTENSION (idempotent guards: IF NOT EXISTS)
02-vehicles-core.sql                   → core entities first
06-drives-charging.sql                 → references vehicles
05-vehicle-meta.sql                    → references vehicles
03-telemetry-hot.sql                   → references vehicles
04-signal-observations.sql             → references vehicles + signal_catalog
07-automations.sql                     → references vehicles, places (places already exists in prior migrations)
08-alerts-notifications.sql            → references vehicles, signals
09-tesla-integration.sql               → references vehicles
10-system.sql                          → may reference vehicles
11-hypertables-compression.sql         → after all tables exist
12-caggs.sql                           → after hypertables exist
```

## Migration mechanics

Because we're additive, the baseline must:

1. **Drop existing tables that are being replaced.** For each table that the new schema redesigns, emit `DROP TABLE IF EXISTS old_name CASCADE;` BEFORE the `CREATE TABLE` for the new shape. Examples:
   - `DROP TABLE IF EXISTS climate_snapshots CASCADE;` before recreating
   - `DROP TABLE IF EXISTS automations CASCADE;` (also drops automation FKs from history tables)
   - `DROP TABLE IF EXISTS tire_pressure_snapshots, media_snapshots, safety_snapshots, vehicle_config_snapshots, user_preference_snapshots CASCADE;` before creating consolidated `vehicle_meta_snapshots`

2. **Drop existing functions and MVs that are being replaced.** Per ADR-006:
   - `DROP FUNCTION IF EXISTS fn_drive_score_breakdown(...) CASCADE;` etc. for the ~10 moved-to-Go functions
   - `DROP FUNCTION IF EXISTS fn_charging_calendar_heatmap(...) CASCADE;` etc. for the converted-to-CAGG functions
   - `DROP MATERIALIZED VIEW IF EXISTS mv_energy_daily, mv_position_hourly, mv_signal_stats CASCADE;`
   - `DROP FUNCTION IF EXISTS fn_battery_cell_balance(...) CASCADE;` etc. for the deleted functions

3. **Drop columns being eliminated:**
   - `ALTER TABLE tesla_charging_history DROP COLUMN IF EXISTS raw_json;` (per ADR-005, all raw_json/json columns)
   - `ALTER TABLE positions DROP COLUMN IF EXISTS signals;` etc. (per ADR-002, signals jsonb is replaced by signal_observations)

4. **Migrate data where reasonable.** Per ADR-002, signals jsonb columns are observed empty in local DB. Verify on prod backup; if non-empty, add an `INSERT INTO signal_observations SELECT ... FROM old_table` step BEFORE the column drop. Otherwise just drop.

5. **Create new tables/types/CAGGs** in the order above.

## Down migration

The down migration is the reverse, but per ADR-008 we accept that **down migration is best-effort, not perfect**. Specifically:
- Recreate dropped tables with their old shape from the relevant prior migration files (copy-paste)
- Recreate dropped functions from prior migrations
- Drop new tables/CAGGs/extensions
- **Do NOT promise data preservation** on rollback — document this clearly at the top of `.down.sql`

## File header (binding template)

```sql
-- 000142_baseline_typed.up.sql
-- Baseline typed schema per .github/prompts/db-refactor/adrs/
-- Applied on top of 141 prior migrations.
-- Squash to a single 000001_baseline.sql is deferred to Program C (future).
--
-- ADRs implemented: 001 (jsonb policy), 002 (signal storage), 003 (snapshot tiers),
--                   004 (automation CTI), 005 (rawjson deletion), 006 (pg functions),
--                   007 (timescaledb engine), 009 (signal onboarding)
--
-- WARNING: This migration is destructive. It DROPs existing snapshot tables, automations,
--          raw_json columns, and ~25 pg functions. Down migration is best-effort and
--          DOES NOT preserve data dropped in the up.

BEGIN;
-- ... statements ...
COMMIT;
```

## Validation

After applying:
```powershell
# Apply locally
docker compose down
docker volume rm teslasync_postgres_data
docker compose up -d postgres
# wait for healthy
$env:MIGRATE_ONLY = "true"; .\teslasync.exe; Remove-Item env:MIGRATE_ONLY

# Run validation queries from prompt 07
docker exec teslasync-postgres psql -U teslasync -d teslasync -f /migrations/validation.sql
```

## Exit gate

- [ ] `migrations/000142_baseline_typed.up.sql` exists
- [ ] `migrations/000142_baseline_typed.down.sql` exists
- [ ] Up applies cleanly on a DB that has 141 prior migrations (with seed data)
- [ ] Up applies cleanly on a fresh DB (with all 141 prior migrations + the baseline)
- [ ] Down applies cleanly (acknowledging data loss disclaimer)
- [ ] Validation queries from prompt 07 all pass
