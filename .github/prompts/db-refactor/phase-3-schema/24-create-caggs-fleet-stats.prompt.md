---
description: "Phase 3 — Create cagg_fleet_stats continuous aggregate (daily fleet roll-ups)"
---

# 🟢 Schema 24 — `cagg_fleet_stats` Continuous Aggregate

> **Severity:** Standard (replaces former mv_energy_daily MV)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (continuous aggregate)
> **Prompt #:** 25 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/24-caggs-fleet-stats.sql` |
| Depends on | `03-create-positions-hypertable`, `11-create-drives` |
| Blocks | (none — leaf) |
| ADR refs | ADR-006 (CAGG conversions) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/24-caggs-fleet-stats.sql` containing one continuous aggregate `cagg_fleet_stats` (daily per-vehicle drive rollup) plus its refresh policy.

## What's Being Established

ADR-006 converts `mv_energy_daily` and similar MVs into TimescaleDB continuous aggregates. Application code reads them as views (no behavior change for callers) but TimescaleDB auto-refreshes them incrementally.

## Recommendation

- `WITH (timescaledb.continuous)` materialized view
- `time_bucket('1 day', start_ts)` over `drives`
- Refresh policy: rebuild last 2 days every hour (catches late-arriving drive completions)

## Output (full file contents)

```sql
-- =========================================================================
-- 24 — cagg_fleet_stats (daily per-vehicle drive roll-up)
-- ADR-006: replaces mv_energy_daily MV.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_fleet_stats
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  time_bucket('1 day', start_ts) AS day,
  count(*)                         AS drive_count,
  sum(distance_mi)                 AS total_distance_mi,
  sum(energy_used_kwh)             AS total_energy_kwh,
  sum(regen_kwh)                   AS total_regen_kwh,
  sum(duration_min)                AS total_duration_min,
  avg(avg_speed_mph)               AS avg_speed_mph,
  max(max_speed_mph)               AS max_speed_mph,
  avg(score)                       AS avg_score
FROM drives
GROUP BY vehicle_id, day
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW cagg_fleet_stats IS
  'Daily per-vehicle drive roll-up. ADR-006 — replaces mv_energy_daily.';

SELECT add_continuous_aggregate_policy('cagg_fleet_stats',
  start_offset      => interval '7 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');
```

## Suggested Fix

1. Confirm `drives` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] CAGG `cagg_fleet_stats` registered in `timescaledb_information.continuous_aggregates`
- [ ] Refresh policy job exists with `schedule_interval = 1 hour`
- [ ] CAGG built `WITH NO DATA` (initial backfill is operational, not part of schema)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\24-caggs-fleet-stats.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# CAGG registered
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name='cagg_fleet_stats';"

# Refresh policy
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proc_name, schedule_interval FROM timescaledb_information.jobs WHERE hypertable_name='cagg_fleet_stats' OR application_name LIKE '%cagg_fleet_stats%';"
```

## Out of Scope

- Don't `REFRESH` here — backfill is a runtime concern (Phase 5e or operational).
- Don't combine multiple time-buckets in one CAGG — keep it 1 day; build other granularities as separate CAGGs if needed.
- Don't `WITH (timescaledb.materialized_only = false)` — keep default for predictable performance.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/24-caggs-fleet-stats.sql
git commit -m "schema(db-refactor): add cagg_fleet_stats continuous aggregate

ADR-006: replaces mv_energy_daily. Daily per-vehicle drive roll-up.
Refresh hourly, last 7 days window, 1h end offset.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-006-pg-functions.md`
