---
description: "Phase 3 — Create signal_observations cold-path hypertable (the spike-validated centerpiece)"
---

# 🔵 Schema 08 — `signal_observations` Hypertable

> **Severity:** Architectural centerpiece (the design ADR-002 spike validated 2026-04-22)
> **Priority:** High (load-bearing for cold-signal storage)
> **Category:** Phase 3 — Schema (hypertable)
> **Prompt #:** 9 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/08-signal-observations.sql` |
| Depends on | `00-extensions` (timescaledb), `01-create-vehicles` (FK target), `09-create-signal-catalog` *(forward-ref via FK — see "Forward FK note" below)* |
| Blocks | `26-create-caggs-signal-hourly`, all Phase 5e telemetry-write prompts |
| ADR refs | ADR-002 (signal storage model) — Accepted, spike-validated 2026-04-22 with 29.34× compression and 2.86ms hot-query latency |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/08-signal-observations.sql` containing the cold-path tall hypertable for ~200 low-frequency signals not promoted to typed columns. One CREATE TABLE, one hypertable conversion, one compression policy, one retention policy, one explicit composite index.

## What's Being Established

ADR-002 splits the ~250 Tesla Fleet Telemetry signals into:
- **Hot** (~50): typed columns on `positions`, `charging_telemetry`, `climate_snapshots`, `motor_snapshots`, `security_events` — fast, narrow, queried by every dashboard
- **Cold** (~200): tall (vehicle_id, ts, signal_name, value_*) rows in this `signal_observations` hypertable — flexible, still typed, queried less often

The Phase 2 spike proved this works: 107K inserts/sec, 2.86 ms hot queries, 29.34× compression, 1.32 ms compressed queries (faster than hot, thanks to vectorized columnar scan).

## Forward FK Note

This file references `signal_catalog(name)` which is created in prompt `09`. When applying schema files in numeric order to `ts-schema-validate`, prompt 09's file runs *after* this one — but `signal_catalog` doesn't exist yet at this point. **Resolution:** in prompt 09 we add `signal_catalog` first, then re-run `08`'s FK addition as `ALTER TABLE`. Alternatively (chosen here): prompt 09 is renumbered to run *before* this prompt during schema apply. **Prompt 09's runner instructions call out that it MUST be applied before this file.** Verify this is the case before running this prompt's verification.

## Recommendation

```sql
-- Decisions baked into this file:
-- 1. Three nullable value_* columns (numeric/text/bool) — exactly one is non-null per row.
--    Alternatives rejected: single jsonb value (bans us from compression), single text
--    (forces every numeric query through cast).
-- 2. signal_name is text + FK to signal_catalog (RESTRICT) — ADR-009 ritual.
-- 3. source is text + CHECK — closed enum, can grow on real need.
-- 4. PK = (vehicle_id, ts, signal_name) — natural key, supports time-range scans.
-- 5. Explicit DESC index — spike showed PK alone gave partial coverage; this one was used.
-- 6. chunk_time_interval = 1 day — at 250 signals × 10 vehicles × 1 reading/30s,
--    a chunk holds ~7.2 M rows = comfortable for compression.
-- 7. Compression segmentby = (vehicle_id, signal_name) — collapses adjacent
--    same-(vehicle, signal) rows into columnar batches. Spike: 29.34× ratio.
-- 8. Retention = 2 years. Older data is in CAGGs anyway (prompt 26).
```

## Output (full file contents)

```sql
-- =========================================================================
-- 08 — signal_observations (cold-path tall hypertable)
-- ADR-002: hot/cold split. ~200 signals not promoted to typed columns
-- land here. Per-row overhead is dominated by signal_name; segmentby
-- compression collapses adjacent rows of the same (vehicle, signal) into
-- columnar batches. Spike-validated 2026-04-22:
--   - Insert: 107,196 rows/sec
--   - Hot query (24h window): 2.86 ms
--   - Compressed query (15-day-old window): 1.32 ms
--   - Compression ratio: 29.34× (8 GB → 273 MB)
-- =========================================================================

CREATE TABLE signal_observations (
  vehicle_id    bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts            timestamptz      NOT NULL,
  signal_name   text             NOT NULL REFERENCES signal_catalog(name) ON DELETE RESTRICT,
  value_numeric double precision,
  value_text    text,
  value_bool    boolean,
  source        text             NOT NULL DEFAULT 'fleet_telemetry'
                                 CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, signal_name)
);

COMMENT ON TABLE signal_observations IS
  'Cold-path tall table for low-frequency signals. ADR-002 hot/cold split. '
  'Hot signals live in typed columns on positions/charging_telemetry/etc.';

COMMENT ON COLUMN signal_observations.signal_name IS
  'Must exist in signal_catalog. FK is RESTRICT so an unknown signal blocks ingest '
  'until catalog is updated (ADR-009 onboarding ritual).';
COMMENT ON COLUMN signal_observations.value_numeric IS
  'Populated for numeric signals. Mutually exclusive with value_text/value_bool.';
COMMENT ON COLUMN signal_observations.value_text IS
  'Populated for string/enum signals (e.g. shift_state). Compound signals are '
  'normalized to JSON-strings upstream in normalizeFleetUnits before insert.';
COMMENT ON COLUMN signal_observations.value_bool IS
  'Populated for boolean signals (e.g. defrost_active).';

-- Promote to hypertable
SELECT create_hypertable('signal_observations', 'ts', chunk_time_interval => interval '1 day');

-- Compression: spike-validated 29.34× ratio with this segmentby
ALTER TABLE signal_observations SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, signal_name',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('signal_observations', interval '7 days');

-- Retention: keep 2 years
SELECT add_retention_policy('signal_observations', interval '2 years');

-- Explicit query index — spike measured 2.86 ms with this exact index
CREATE INDEX idx_signal_obs_vehicle_signal_ts
  ON signal_observations (vehicle_id, signal_name, ts DESC);
```

## Suggested Fix (implementation steps)

1. Confirm `vehicles` and `signal_catalog` already exist in the throwaway DB:
   ```powershell
   docker exec ts-schema-validate psql -U postgres -d v -c "\dt vehicles" "\dt signal_catalog"
   ```
   If either is missing, stop — earlier prompts (01, 09) must run first.
2. Write the file contents above to `schema/08-signal-observations.sql`.
3. Apply via the cumulative throwaway DB.
4. Run verification (below).
5. Commit (boilerplate at bottom).

## Acceptance Criteria

- [ ] File `schema/08-signal-observations.sql` exists and matches the output above exactly
- [ ] `psql -f` succeeds with zero errors and zero warnings
- [ ] `timescaledb_information.hypertables` lists `signal_observations` with `num_dimensions = 1`
- [ ] `compression_enabled = t` on the hypertable row
- [ ] **Two** background jobs registered for this hypertable: `policy_compression` and `policy_retention`
- [ ] Index `idx_signal_obs_vehicle_signal_ts` exists with the exact column order `(vehicle_id, signal_name, ts DESC)`
- [ ] Zero JSONB columns on this table (the running invariant)
- [ ] FK to `signal_catalog` is `ON DELETE RESTRICT` (NOT cascade — orphan blocks deletion)
- [ ] FK to `vehicles` is `ON DELETE CASCADE`
- [ ] All four `COMMENT ON COLUMN` statements applied
- [ ] File is committed with the boilerplate message below

## Verification

```powershell
# Apply
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\08-signal-observations.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Hypertable registered
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT hypertable_name, num_dimensions, compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = 'signal_observations';"
# Expected: 1 row, num_dimensions=1, compression_enabled=t

# Two policies registered
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proc_name FROM timescaledb_information.jobs WHERE hypertable_name = 'signal_observations' ORDER BY proc_name;"
# Expected: policy_compression, policy_retention

# Index present with correct definition
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexdef FROM pg_indexes WHERE tablename = 'signal_observations' AND indexname = 'idx_signal_obs_vehicle_signal_ts';"

# Zero JSONB columns
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'signal_observations' AND data_type IN ('jsonb','json');"
# Expected: 0 rows

# FK ON DELETE behaviors
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'signal_observations'::regclass AND contype = 'f';"
# Expected: 2 rows; confdeltype 'c' (CASCADE) for vehicles, 'r' (RESTRICT) for signal_catalog
```

## Out of Scope (reject if asked)

- Don't add CAGGs here — hourly rollup CAGG is prompt `26-create-caggs-signal-hourly`.
- Don't add hot signals (battery_level, latitude, …) — those live in typed-column files (03-positions, 04-charging-telemetry, etc.).
- Don't seed `signal_catalog` rows here — that's runtime startup logic in Phase 5e.
- Don't widen the `source` CHECK list speculatively — add new sources only when the write path needs them.
- Don't change `chunk_time_interval` without rerunning the spike — 1 day is what we measured.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/08-signal-observations.sql
git commit -m "schema(db-refactor): add signal_observations hypertable

ADR-002 cold-path hypertable. Spike-validated 2026-04-22:
  - 107k inserts/sec, 2.86ms hot query, 29.34x compression
Compression segmentby (vehicle_id, signal_name); retention 2y.
Explicit composite index (vehicle_id, signal_name, ts DESC) — the
spike's measured query plan used this exact index.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-002-signal-storage-model.md` — design + Spike Results section
- `.github/prompts/db-refactor/adrs/ADR-009-future-signal-onboarding.md` — why FK is RESTRICT, not CASCADE
- `.github/prompts/db-refactor/phase-3-schema/26-create-caggs-signal-hourly.prompt.md` — the CAGG that depends on this table
