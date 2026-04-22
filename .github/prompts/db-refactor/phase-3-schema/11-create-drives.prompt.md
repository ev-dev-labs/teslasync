---
description: "Phase 3 — Create drives table (one row per completed drive)"
---

# 🟢 Schema 11 — `drives`

> **Severity:** Standard (one of three core session-summary tables)
> **Priority:** Medium-High
> **Category:** Phase 3 — Schema (mutable, non-hypertable)
> **Prompt #:** 12 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/11-drives.sql` |
| Depends on | `01-create-vehicles` (FK + trigger fn) |
| Blocks | `13-create-trips` (trip references drive_id), `25-create-caggs-charging-summary`, `24-create-caggs-fleet-stats` |
| ADR refs | ADR-001 (typed-by-default — replaces any prior `drive_metadata jsonb`) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/11-drives.sql` containing one row per completed drive, with summary statistics computed at drive-end by the FSM.

## What's Being Established

`drives` is the parent for all drive-scoped analytics. It's small (one row per drive, ~10s of rows/day/vehicle), mutable (drive can be re-scored after the fact), and queried by every drive dashboard.

## Recommendation

- `id bigint GENERATED ALWAYS AS IDENTITY`
- FK to `vehicles(id) ON DELETE CASCADE`
- `start_ts`/`end_ts timestamptz NOT NULL`
- All distance values stored in **miles** per repo memory (useSettings.convertDistance expects miles)
- All temperature values in **Celsius**
- Energy in **kWh**
- `score` is `numeric(5,2)` — max 999.99 (never expected, but forward-safe)
- `set_updated_at` trigger

## Output (full file contents)

```sql
-- =========================================================================
-- 11 — drives (one row per completed drive)
-- ADR-001: fully typed; no jsonb metadata column.
-- =========================================================================

CREATE TABLE drives (
  id                   bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id           bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_ts             timestamptz      NOT NULL,
  end_ts               timestamptz      NOT NULL,
  duration_min         double precision NOT NULL,
  distance_mi          double precision NOT NULL,        -- miles per repo memory
  start_address        text,
  end_address          text,
  start_lat            double precision,
  start_lon            double precision,
  end_lat              double precision,
  end_lon              double precision,
  start_battery_pct    smallint,
  end_battery_pct      smallint,
  energy_used_kwh      double precision,
  regen_kwh            double precision,
  avg_speed_mph        double precision,
  max_speed_mph        double precision,
  avg_power_kw         double precision,
  outside_temp_avg_c   double precision,
  inside_temp_avg_c    double precision,
  score                numeric(5, 2),
  ended_status         text             CHECK (ended_status IN ('completed','aborted','interrupted','unknown')),
  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now(),
  CHECK (end_ts >= start_ts)
);

COMMENT ON TABLE  drives IS 'One row per completed drive. Mutable (re-scoring updates score column).';
COMMENT ON COLUMN drives.distance_mi IS 'Stored in miles. UI converts via useSettings.convertDistance.';
COMMENT ON COLUMN drives.energy_used_kwh IS 'Net energy used; regen subtracted into regen_kwh column separately.';

CREATE TRIGGER drives_set_updated_at
  BEFORE UPDATE ON drives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_drives_vehicle_start  ON drives (vehicle_id, start_ts DESC);
CREATE INDEX idx_drives_start_ts       ON drives (start_ts DESC);
```

## Suggested Fix

1. Confirm `vehicles` and `set_updated_at()` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] Table NOT a hypertable (PK = `id` GENERATED IDENTITY)
- [ ] FK to vehicles is CASCADE
- [ ] CHECK on `ended_status` applied
- [ ] CHECK on `end_ts >= start_ts` applied
- [ ] Both indexes present
- [ ] Trigger `drives_set_updated_at` registered
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\11-drives.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# NOT a hypertable
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name='drives';"
# Expected: 0

# Indexes
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexname FROM pg_indexes WHERE tablename='drives' ORDER BY indexname;"
```

## Out of Scope

- Don't add `vampire_drain` or `mileage_history` — those are separate tables in `23-create-system-tables`.
- Don't add `drive_score_breakdown` — score is computed in Go (`internal/analytics/drive_score.go` per ADR-006).
- Don't make this a hypertable — too few rows; PK indices are fine.
- Don't add a `metadata jsonb` column — ADR-001 forbids speculative jsonb.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/11-drives.sql
git commit -m "schema(db-refactor): add drives table

One row per completed drive. Distance in miles per useSettings convention.
Score computed in Go (ADR-006), no jsonb metadata column (ADR-001).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
- `.github/prompts/db-refactor/adrs/ADR-006-pg-functions.md`
- Repo memory: useSettings.convertDistance expects miles
