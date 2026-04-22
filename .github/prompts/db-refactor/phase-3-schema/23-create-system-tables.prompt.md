---
description: "Phase 3 — Create system tables (settings/places/geofence/electricity_cost/audit/embeddings/...) and close all forward FKs"
---

# 🔵 Schema 23 — System Tables (+ Close Forward FKs from 15 & 17)

> **Severity:** Architectural (closes the last forward FKs in the schema)
> **Priority:** Medium-High
> **Category:** Phase 3 — Schema (omnibus system file)
> **Prompt #:** 24 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/23-system-tables.sql` |
| Depends on | `01-create-vehicles`, `15-create-automation-conditions`, `17-create-automation-step-children` (closes their `places` FKs) |
| Blocks | (none) |
| ADR refs | ADR-001, ADR-007 (vector for embeddings) |
| Estimated effort | medium (~60 min — many tables) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/23-system-tables.sql` containing the system/admin/runtime tables: `settings`, `polling_config`, `places`, `geofences`, `electricity_cost`, `gas_prices`, `audit_logs`, `embeddings`, `command_executions`, `fsm_transitions`. Plus the deferred FK closures for `places(id)` from prompts 15 and 17.

## What's Being Established

These are the small "everything else" tables. Grouping them keeps the schema apply order simple. The file ends with two `ALTER TABLE … ADD FOREIGN KEY` statements that close the forward `places` FKs from the automation tree.

## Recommendation

- One `CREATE TABLE` per logical artifact, all in one file
- Triggers on every mutable table
- `embeddings` uses `vector` extension (loaded in 00-extensions)
- `audit_logs` and `command_executions` and `fsm_transitions` are **append-only** (no `updated_at`)
- File ends with the two FK ALTER statements

## Output (full file contents)

```sql
-- =========================================================================
-- 23 — system tables (settings / places / electricity / audit / etc.)
-- Closes deferred places FKs from prompts 15 and 17.
-- =========================================================================

-- ============= settings (key-value, typed) =============

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value_text  text,
  value_num   double precision,
  value_bool  boolean,
  data_kind   text NOT NULL CHECK (data_kind IN ('text','number','boolean')),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE settings IS 'Typed key-value store. data_kind selects which value_* column is meaningful.';
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= polling_config (per-vehicle polling tuning) =============

CREATE TABLE polling_config (
  vehicle_id           bigint PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  awake_interval_sec   integer NOT NULL DEFAULT 30  CHECK (awake_interval_sec  >= 5),
  asleep_interval_sec  integer NOT NULL DEFAULT 300 CHECK (asleep_interval_sec >= 60),
  driving_interval_sec integer NOT NULL DEFAULT 5   CHECK (driving_interval_sec >= 1),
  enabled              boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE polling_config IS 'Per-vehicle polling tuning. Defaults match docker-compose POLL_INTERVAL convention.';
CREATE TRIGGER polling_config_set_updated_at BEFORE UPDATE ON polling_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= places (named locations) =============

CREATE TABLE places (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text             NOT NULL,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  radius_m    integer          NOT NULL DEFAULT 100 CHECK (radius_m > 0),
  category    text             CHECK (category IN ('home','work','charging','custom')),
  created_at  timestamptz      NOT NULL DEFAULT now(),
  updated_at  timestamptz      NOT NULL DEFAULT now()
);
COMMENT ON TABLE places IS 'Named locations. radius_m used for "inside place" tests at runtime.';
CREATE TRIGGER places_set_updated_at BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_places_category ON places (category);

-- ============= geofences (multi-point polygons stored as text WKT) =============

CREATE TABLE geofences (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name         text             NOT NULL,
  polygon_wkt  text             NOT NULL,                  -- POLYGON((lon lat, ...)) WKT
  category     text             CHECK (category IN ('home','work','restricted','custom')),
  created_at   timestamptz      NOT NULL DEFAULT now(),
  updated_at   timestamptz      NOT NULL DEFAULT now()
);
COMMENT ON TABLE  geofences IS 'Polygonal geofences. WKT text — no PostGIS dependency in Phase 3.';
COMMENT ON COLUMN geofences.polygon_wkt IS 'Well-Known Text POLYGON((lon lat, ...)). Runtime parses; not queried server-side.';
CREATE TRIGGER geofences_set_updated_at BEFORE UPDATE ON geofences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= electricity_cost (per-region rate schedule) =============

CREATE TABLE electricity_cost (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  region       text           NOT NULL,
  start_time   time           NOT NULL,
  end_time     time           NOT NULL,
  rate_per_kwh numeric(10, 6) NOT NULL CHECK (rate_per_kwh >= 0),
  currency     text           NOT NULL DEFAULT 'USD',
  effective_from timestamptz  NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_at   timestamptz    NOT NULL DEFAULT now(),
  updated_at   timestamptz    NOT NULL DEFAULT now()
);
COMMENT ON TABLE electricity_cost IS 'Time-of-use electricity rate schedule. Joined into charging_sessions cost computation.';
CREATE TRIGGER electricity_cost_set_updated_at BEFORE UPDATE ON electricity_cost FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_electricity_region_time ON electricity_cost (region, start_time);

-- ============= gas_prices (regional gas price snapshots, append-only) =============

CREATE TABLE gas_prices (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ts           timestamptz    NOT NULL DEFAULT now(),
  region       text           NOT NULL,
  grade        text           NOT NULL DEFAULT 'regular' CHECK (grade IN ('regular','midgrade','premium','diesel')),
  price_per_gallon numeric(10, 4) NOT NULL CHECK (price_per_gallon >= 0),
  currency     text           NOT NULL DEFAULT 'USD',
  source       text           NOT NULL DEFAULT 'eia'
);
COMMENT ON TABLE gas_prices IS 'Append-only regional gas price snapshots. Source: EIA adapter.';
CREATE INDEX idx_gas_region_ts ON gas_prices (region, ts DESC);

-- ============= audit_logs (append-only) =============

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  ts          timestamptz NOT NULL DEFAULT now(),
  actor       text        NOT NULL,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   bigint,
  detail      text,
  PRIMARY KEY (ts, id)
);
COMMENT ON TABLE audit_logs IS 'Append-only audit trail. detail is plain text, not jsonb.';
CREATE INDEX idx_audit_actor_ts  ON audit_logs (actor, ts DESC);
CREATE INDEX idx_audit_entity    ON audit_logs (entity_type, entity_id, ts DESC);

-- ============= command_executions (append-only) =============

CREATE TABLE command_executions (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  ts            timestamptz NOT NULL DEFAULT now(),
  vehicle_id    bigint      NOT NULL REFERENCES vehicles(id) ON DELETE SET NULL,
  command       text        NOT NULL,
  invoked_by    text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out')),
  duration_ms   integer,
  error_message text,
  PRIMARY KEY (ts, id)
);
COMMENT ON TABLE command_executions IS 'Append-only Tesla command invocation log.';
CREATE INDEX idx_command_vehicle_ts ON command_executions (vehicle_id, ts DESC);

-- ============= fsm_transitions (append-only state machine log) =============

CREATE TABLE fsm_transitions (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  ts          timestamptz NOT NULL DEFAULT now(),
  vehicle_id  bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_state  text        NOT NULL,
  to_state    text        NOT NULL,
  trigger     text,
  PRIMARY KEY (ts, id)
);
COMMENT ON TABLE fsm_transitions IS 'Append-only FSM transition log. Used for stuck-state diagnostics.';
CREATE INDEX idx_fsm_vehicle_ts ON fsm_transitions (vehicle_id, ts DESC);

-- ============= embeddings (pgvector) =============

CREATE TABLE embeddings (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entity_type text        NOT NULL,
  entity_id   bigint      NOT NULL,
  embedding   vector(384) NOT NULL,
  model       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, model)
);
COMMENT ON TABLE embeddings IS 'pgvector-backed embeddings for entity search. Dimension 384 matches default sentence-transformer.';
CREATE TRIGGER embeddings_set_updated_at BEFORE UPDATE ON embeddings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= Close deferred FKs from prompts 15 and 17 =============

ALTER TABLE automation_step_condition_geofence
  ADD CONSTRAINT cond_geofence_place_fk
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE RESTRICT;

ALTER TABLE automation_step_trigger_geofence
  ADD CONSTRAINT trig_geofence_place_fk
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE RESTRICT;
```

## Suggested Fix

1. Confirm `vehicles`, `automation_step_condition_geofence`, `automation_step_trigger_geofence` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] All 10 tables created (settings, polling_config, places, geofences, electricity_cost, gas_prices, audit_logs, command_executions, fsm_transitions, embeddings)
- [ ] `audit_logs`, `gas_prices`, `command_executions`, `fsm_transitions` have **NO** `updated_at` (append-only)
- [ ] All other 6 have triggers
- [ ] Both deferred FKs to `places(id)` are now closed with `ON DELETE RESTRICT`
- [ ] `embeddings.embedding` is type `vector(384)`
- [ ] All CHECK constraints applied (data_kind, intervals, radius_m, rate_per_kwh, etc.)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\23-system-tables.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Both places FKs closed
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('cond_geofence_place_fk','trig_geofence_place_fk');"
# Expected: 2 rows, both 'r'

# Append-only tables have no updated_at
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT table_name FROM information_schema.tables t WHERE table_schema='public' AND table_name IN ('audit_logs','gas_prices','command_executions','fsm_transitions') AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=t.table_name AND c.column_name='updated_at');"
# Expected: 4 rows

# embeddings dim = 384
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT atttypmod FROM pg_attribute WHERE attrelid='embeddings'::regclass AND attname='embedding';"
# Expected: 384
```

## Out of Scope

- Don't add `users` / `api_keys` / `backup_*` / `export_jobs` — defer to a future Phase 3 prompt or post-Phase-3 work.
- Don't make `audit_logs` a hypertable — current volume doesn't justify it.
- Don't switch `geofences.polygon_wkt` to PostGIS `geometry` — out of Phase 3 scope.
- Don't add CRUD triggers to audit-log other tables — explicit `INSERT` from Go is preferred.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/23-system-tables.sql
git commit -m "schema(db-refactor): add system tables + close places FKs

10 system/runtime tables: settings, polling_config, places, geofences,
electricity_cost, gas_prices, audit_logs, command_executions,
fsm_transitions, embeddings (pgvector). Closes deferred places FKs
from prompts 15 and 17 (RESTRICT — protects in-use places).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
- `.github/prompts/db-refactor/adrs/ADR-007-engine-strategy.md` (vector extension)
