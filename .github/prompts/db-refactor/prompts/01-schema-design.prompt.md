# 01 — Schema Design (produces schema/*.sql)

**Phase:** 3
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`
**Pre-req:** All ADRs Accepted; Phase 2 spike passed
**Output:** `.github/prompts/db-refactor/schema/*.sql` (12 files)
**Estimated effort:** 2 days

---

## Goal

Translate the 9 ADRs into concrete annotated DDL. Output is **reference SQL** (not yet a migration) — fully formed `CREATE TABLE`/`CREATE TYPE`/`CREATE INDEX`/`COMMENT ON COLUMN` statements that Phase 5 (`02-assemble-baseline-migration`) will assemble into the actual baseline migration.

## Output structure

Create files in `.github/prompts/db-refactor/schema/`:

```
01-extensions.sql              CREATE EXTENSION timescaledb, vector, pg_stat_statements
02-vehicles-core.sql           vehicles, vehicle_live_state, vehicle_units, users (if any)
03-telemetry-hot.sql           positions, charging_telemetry, climate_snapshots, motor_snapshots, security_events
                               (typed hot signals only, hypertables w/ compression+retention from ADR-003)
04-signal-observations.sql     The cold-path tall hypertable (ADR-002) + signal_catalog table (ADR-009)
05-vehicle-meta.sql            Consolidated low-freq vehicle_meta_snapshots + category enum (ADR-003)
06-drives-charging.sql         drives, charging_sessions, trips, drive_score_*, vampire_drain, mileage_history
07-automations.sql             Class table inheritance per ADR-004, including command_params jsonb carve-out
08-alerts-notifications.sql    alert_rules + child tables, notifications, channels, channel_config, cooldowns, quiet_hours, digests
09-tesla-integration.sql       Tesla API tables, NO raw_json (ADR-005)
10-system.sql                  settings, polling_config, gas_price, places, geofence, electricity_cost,
                               command_executions, audit_logs, api_call_logs, api_keys, export_jobs,
                               fsm_transitions, backup_configs/runs, embeddings, fleet_telemetry_subscriptions
11-hypertables-compression.sql ALL hypertable_create + compression_segmentby + add_compression_policy +
                               add_retention_policy in ONE place for operational visibility
12-caggs.sql                   All continuous aggregates (ADR-006 conversions) + their refresh policies
```

## Design rules (binding — every file must follow)

1. **Zero `jsonb`** except: `automation_actions.command_params` (ADR-004 carve-out — must include `COMMENT ON COLUMN ... IS 'JSONB carve-out per ADR-001/ADR-004 — never use in WHERE/GROUP BY/ORDER BY in production.';`)
2. **Zero `json`** anywhere
3. **Zero `text[]`/`varchar[]` of structs**. Plain `text[]` for tag lists is acceptable when there's no per-tag metadata.
4. **`timestamptz` only** for timestamps. Never `timestamp without time zone`. Never `text` for dates.
5. **`bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY`** for all surrogate keys (no `serial`/`bigserial`)
6. **`numeric(precision, scale)`** for monetary; **`double precision`** for sensor readings; never `real`
7. **`smallint`** for enums when count <128 (rare); otherwise `text` with `CHECK (col IN (...))` or a `CREATE TYPE ... AS ENUM`
8. **Every table** ends with `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()` (with trigger to maintain `updated_at`) UNLESS the table is append-only (hypertables, audit logs)
9. **Every column** with non-obvious source/units gets `COMMENT ON COLUMN`
10. **Every FK** specifies `ON DELETE` behavior explicitly (CASCADE / SET NULL / RESTRICT / NO ACTION — pick deliberately)
11. **Every hypertable** has compression + retention defined in `11-hypertables-compression.sql`
12. **Every CAGG** has a refresh policy

## Hot signal selection (for `03-telemetry-hot.sql`)

The hot signal catalog is derived from:
- Source 1: `internal/enums/signal_types.go` — known signals
- Source 2: Phase 2 spike output, if it includes query-frequency analysis
- Source 3: Grep `web/src/api/hooks/` and `grafana/` for signal names actually queried by frontend/dashboards

Document the selection methodology at the top of `03-telemetry-hot.sql`. Aim for ~50 hot signals total across all 5 hot tables.

## Process

1. Read all 9 ADRs end-to-end again — ensure decisions are fresh in mind
2. Read existing schema (`migrations/*.up.sql`) for reference shapes — but DO NOT copy. Redesign.
3. For each table in the current schema, decide:
   - Keep (which tier — hot, low-freq consolidated, system, etc.)
   - Modify (typing changes, FK additions, jsonb removal)
   - Delete (e.g., redundant snapshot tables consolidated per ADR-003, raw_json columns per ADR-005)
4. Write each schema file with full DDL + comments + indexes + constraints
5. Cross-check: every `jsonb` in the output must have a `COMMENT ON COLUMN ... IS 'JSONB carve-out per ADR-XXX...';`
6. Cross-check: total `jsonb` columns in output = 1 (`automation_actions.command_params`)
7. Run a syntax check by piping each file through `psql --no-psqlrc -f` against an empty DB

## Validation queries (run after assembling)

```sql
-- Must return 1 (only automation_actions.command_params)
SELECT count(*) FROM information_schema.columns
WHERE data_type IN ('jsonb','json') AND table_schema = 'public';

-- Must return 0
SELECT count(*) FROM information_schema.columns
WHERE data_type IN ('json') AND table_schema = 'public';

-- All tables must have audit columns (or be on the append-only allowlist)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name NOT IN (<append_only_allowlist>)
  AND table_name NOT IN (
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'created_at' AND table_schema = 'public'
  );
```

## Exit gate

- [ ] 12 schema files produced
- [ ] Each file syntax-validates via `psql -f` against empty DB
- [ ] JSONB count check returns exactly 1
- [ ] Every JSONB column has the carve-out comment
- [ ] Hot signal selection methodology documented
- [ ] Schema files committed to this branch (still no migration yet)
