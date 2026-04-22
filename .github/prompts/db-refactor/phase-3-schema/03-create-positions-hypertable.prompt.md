---
description: "Phase 3 — Create positions hypertable (high-frequency GPS/speed history)"
---

# 🔵 Schema 03 — `positions` Hypertable

> **Severity:** Hot path (highest write rate of any table — 1-10 Hz when driving)
> **Priority:** High
> **Category:** Phase 3 — Schema (hypertable)
> **Prompt #:** 4 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/03-positions.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | `24-create-caggs-fleet-stats` (some metrics aggregate over positions) |
| ADR refs | ADR-002 (hot signal), ADR-003 (positions kept separate due to write rate + 365d retention) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/03-positions.sql` containing the `positions` hypertable for high-frequency GPS + motion telemetry. One CREATE TABLE, one hypertable, one compression policy, one retention policy, one explicit index.

## What's Being Established

ADR-003 keeps `positions` as its own hypertable (not consolidated) because it has the highest write frequency in the schema (1-10 Hz when driving, often >86,400 rows/day/vehicle). Compression + 365-day retention are tuned independently from the slower snapshots.

## Recommendation

- PK = `(vehicle_id, ts)` — natural composite for time-series
- Hypertable on `ts`, 1-day chunks
- Compression segmentby `vehicle_id`, orderby `ts DESC`, after 7 days
- Retention 365 days
- Explicit index `(vehicle_id, ts DESC)` for "last N positions" queries
- `latitude`/`longitude` as `double precision` (not `numeric` — geo precision needs IEEE 754, not arbitrary)

## Output (full file contents)

```sql
-- =========================================================================
-- 03 — positions (hot hypertable, highest write rate in schema)
-- ADR-003: kept separate from low-freq snapshots; 365d retention.
-- =========================================================================

CREATE TABLE positions (
  vehicle_id   bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts           timestamptz      NOT NULL,
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  heading      smallint,
  speed_mph    double precision,
  elevation_m  double precision,
  gps_state    text,
  source       text             NOT NULL DEFAULT 'fleet_telemetry'
                                CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  positions IS
  'High-frequency GPS + motion. ADR-003 hot tier — kept separate from low-freq snapshots due to write rate.';
COMMENT ON COLUMN positions.speed_mph IS 'Mph from Tesla; conversion to user units happens in API layer.';
COMMENT ON COLUMN positions.elevation_m IS 'Meters above sea level from Fleet Telemetry.';

SELECT create_hypertable('positions', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE positions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('positions', interval '7 days');
SELECT add_retention_policy ('positions', interval '365 days');

CREATE INDEX idx_positions_vehicle_ts ON positions (vehicle_id, ts DESC);
```

## Suggested Fix (implementation steps)

1. Confirm `vehicles` exists in throwaway DB.
2. Write the file contents above to `schema/03-positions.sql`.
3. Apply via the throwaway container.
4. Run verification.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching the output above
- [ ] `psql -f` succeeds
- [ ] Hypertable registered on `ts` with `chunk_time_interval = 1 day`
- [ ] `compression_enabled = t`
- [ ] Two background jobs: `policy_compression`, `policy_retention`
- [ ] Index `idx_positions_vehicle_ts (vehicle_id, ts DESC)` present
- [ ] FK to `vehicles` is `ON DELETE CASCADE`
- [ ] **Zero** JSONB columns
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\03-positions.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT hypertable_name, compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name='positions';"

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proc_name FROM timescaledb_information.jobs WHERE hypertable_name='positions' ORDER BY proc_name;"
# Expected: policy_compression, policy_retention
```

## Out of Scope (reject if asked)

- Don't add PostGIS `geometry`/`geography` types — out of scope for Phase 3 (potential ADR-010 future).
- Don't add a `geofence_id` denormalization — geofence resolution is runtime.
- Don't move `positions` into `vehicle_meta_snapshots` — write rate is too high (ADR-003 keeps it separate).

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/03-positions.sql
git commit -m "schema(db-refactor): add positions hypertable

Hot-tier high-frequency GPS + motion. 1-day chunks, compression after 7d,
365d retention. Per ADR-003 kept separate from low-freq snapshots.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-002-signal-storage-model.md`
- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
