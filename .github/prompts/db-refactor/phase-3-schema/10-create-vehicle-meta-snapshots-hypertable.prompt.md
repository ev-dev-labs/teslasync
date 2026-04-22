---
description: "Phase 3 — Create vehicle_meta_snapshots hypertable (consolidated low-freq snapshots)"
---

# 🔵 Schema 10 — `vehicle_meta_snapshots` (Consolidated Low-Freq Hypertable)

> **Severity:** Architectural (consolidates 5 low-freq snapshot tables into 1 — the centerpiece of ADR-003)
> **Priority:** High
> **Category:** Phase 3 — Schema (hypertable, wide table)
> **Prompt #:** 11 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/10-vehicle-meta-snapshots.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | (none directly — feeds historical low-freq queries) |
| ADR refs | ADR-003 (consolidation decision) |
| Estimated effort | medium (~45 min — wide table, many `COMMENT ON COLUMN`) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/10-vehicle-meta-snapshots.sql` containing the consolidated wide hypertable that replaces 5 separate low-freq snapshot tables: `tire_pressure_snapshots`, `media_snapshots`, `safety_snapshots`, `vehicle_config_snapshots`, `user_preference_snapshots`.

## What's Being Established

ADR-003 collapses 5 nearly-identical write paths into 1 wide table with a `category` discriminator. NULLs from non-matching categories are essentially free in TimescaleDB columnstore after compression. Reduces operational surface (5 hypertables → 1), keeps writes infrequent (event-driven, not streaming).

## Recommendation

- PK = `(vehicle_id, ts, category)` — discriminator in PK allows simultaneous events of different categories
- `category` text + CHECK over the 5 source tiers
- 7-day chunks (event-driven → sparse), compression after 30 days, 730-day retention
- Per-category column groups, all nullable
- Single index on `(vehicle_id, category, ts DESC)` — every query filters by category

## Output (full file contents)

```sql
-- =========================================================================
-- 10 — vehicle_meta_snapshots (consolidated low-freq hypertable)
-- ADR-003: replaces tire_pressure_snapshots, media_snapshots,
-- safety_snapshots, vehicle_config_snapshots, user_preference_snapshots.
-- One wide table, NULL-heavy, columnstore compresses NULLs to ~zero cost.
-- =========================================================================

CREATE TABLE vehicle_meta_snapshots (
  vehicle_id   bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts           timestamptz      NOT NULL,
  category     text             NOT NULL
                                CHECK (category IN ('tire','media','safety','config','preference')),

  -- Tire (category='tire')
  tire_pressure_fl_psi      double precision,
  tire_pressure_fr_psi      double precision,
  tire_pressure_rl_psi      double precision,
  tire_pressure_rr_psi      double precision,
  tire_temp_fl_c            double precision,
  tire_temp_fr_c            double precision,
  tire_temp_rl_c            double precision,
  tire_temp_rr_c            double precision,

  -- Media (category='media')
  media_source              text,
  media_track_title         text,
  media_track_artist        text,
  media_track_album         text,
  media_volume              double precision,        -- per migration 000140 widened to float
  media_is_playing          boolean,
  media_track_duration_sec  integer,

  -- Safety (category='safety')
  autopilot_state           text,
  fcw_active                boolean,
  blind_spot_active         boolean,
  emergency_lane_assist     boolean,
  abs_active                boolean,
  speed_limit_mode          text,

  -- Config (category='config')
  software_version          text,
  car_type                  text,
  exterior_color            text,
  wheel_type                text,
  spoiler_type              text,
  has_ludicrous_mode        boolean,

  -- Preference (category='preference')
  drive_mode                text,
  regen_level               text,
  steering_mode             text,
  acceleration_mode         text,
  climate_keeper_mode       text,
  pet_mode                  boolean,

  source       text             NOT NULL DEFAULT 'fleet_telemetry'
                                CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, category)
);

COMMENT ON TABLE  vehicle_meta_snapshots IS
  'ADR-003 consolidated low-freq hypertable. Replaces 5 separate snapshot tables. category discriminator selects active column group; others NULL.';
COMMENT ON COLUMN vehicle_meta_snapshots.category IS
  'One of tire, media, safety, config, preference. Determines which column group is populated.';
COMMENT ON COLUMN vehicle_meta_snapshots.media_volume IS
  'Widened to double precision per migration 000140 (was integer pre-refactor).';

SELECT create_hypertable('vehicle_meta_snapshots', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE vehicle_meta_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, category',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('vehicle_meta_snapshots', interval '30 days');
SELECT add_retention_policy ('vehicle_meta_snapshots', interval '730 days');

CREATE INDEX idx_vmeta_vehicle_cat_ts
  ON vehicle_meta_snapshots (vehicle_id, category, ts DESC);
```

## Suggested Fix

1. Confirm `vehicles` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] Hypertable registered with **7-day** chunks
- [ ] Compression segmentby includes `category` (collapses by tier as well as vehicle)
- [ ] Compression delay = 30d, retention = 730d
- [ ] `category` CHECK over the 5 tiers exactly
- [ ] Index `idx_vmeta_vehicle_cat_ts` present
- [ ] **Zero** JSONB
- [ ] PK includes `category`
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\10-vehicle-meta-snapshots.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# segmentby includes category
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT segmentby FROM timescaledb_information.compression_settings WHERE hypertable_name='vehicle_meta_snapshots';"
# Expected: vehicle_id,category

# CHECK lists all 5 categories
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='vehicle_meta_snapshots'::regclass AND contype='c' AND conname LIKE '%category%';"
```

## Out of Scope

- Don't fold `security_events` in — its 5y retention is incompatible (ADR-003 keeps separate).
- Don't fold `climate_snapshots` in — write rate too high.
- Don't add a `category` enum type instead of CHECK — text+CHECK keeps migrations cheap when adding categories.
- Don't try to split `safety` back into its own table for compliance — current ADR keeps it consolidated; revisit if compliance review demands.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/10-vehicle-meta-snapshots.sql
git commit -m "schema(db-refactor): add vehicle_meta_snapshots consolidated hypertable

ADR-003 consolidation: replaces tire_pressure_snapshots, media_snapshots,
safety_snapshots, vehicle_config_snapshots, user_preference_snapshots.
7-day chunks, compression segmentby (vehicle_id, category), 730d retention.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
- Repo memory: media_volume widened to float (migration 000140)
