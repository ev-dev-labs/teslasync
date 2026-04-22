---
description: "Phase 3 — Create cagg_signal_hourly continuous aggregate (cold-signal hourly roll-up)"
---

# 🟢 Schema 26 — `cagg_signal_hourly` Continuous Aggregate

> **Severity:** Standard (the cold-signal CAGG that lets us drop signal_observations after 2 years)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (continuous aggregate)
> **Prompt #:** 27 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/26-caggs-signal-hourly.sql` |
| Depends on | `08-create-signal-observations-hypertable` |
| Blocks | (none — final CAGG) |
| ADR refs | ADR-006, ADR-002 (so the 2-year retention on signal_observations doesn't lose long-term shape data) |
| Estimated effort | small (~25 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/26-caggs-signal-hourly.sql` containing one continuous aggregate `cagg_signal_hourly` (per-hour per-(vehicle, signal) summary of cold signals). Combined with the 2-year retention on `signal_observations`, this gives us indefinite long-term signal trend data at low cost.

## What's Being Established

ADR-006 replaces `mv_signal_stats` with a CAGG. ADR-002's 2-year retention on `signal_observations` is acceptable specifically because this CAGG preserves long-term shape (count/avg/min/max per hour) at a fraction of the storage cost.

## Recommendation

- Bucket: 1 hour
- Group by `(vehicle_id, signal_name, hour)`
- Aggregates: `count`, `avg(value_numeric)`, `min(value_numeric)`, `max(value_numeric)`
- Skip `value_text`/`value_bool` — those are categorical, not aggregable
- No retention policy on the CAGG itself (keep forever)
- Refresh hourly, last 30d window

## Output (full file contents)

```sql
-- =========================================================================
-- 26 — cagg_signal_hourly (cold-signal hourly roll-up)
-- ADR-006: replaces mv_signal_stats. Combined with signal_observations'
-- 2-year retention (ADR-002), gives indefinite long-term signal shape.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_signal_hourly
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  signal_name,
  time_bucket('1 hour', ts) AS hour,
  count(*)                  AS sample_count,
  avg(value_numeric)        AS avg_value,
  min(value_numeric)        AS min_value,
  max(value_numeric)        AS max_value
FROM signal_observations
WHERE value_numeric IS NOT NULL
GROUP BY vehicle_id, signal_name, hour
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW cagg_signal_hourly IS
  'Hourly per-(vehicle, signal) numeric roll-up. ADR-006 replaces mv_signal_stats. Excludes text/bool signals.';

SELECT add_continuous_aggregate_policy('cagg_signal_hourly',
  start_offset      => interval '30 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');
```

## Suggested Fix

1. Confirm `signal_observations` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] CAGG `cagg_signal_hourly` registered
- [ ] Refresh policy: start_offset = 30d, end_offset = 1h, schedule = 1h
- [ ] CAGG WHERE clause filters `value_numeric IS NOT NULL`
- [ ] No retention policy on the CAGG (keep forever)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\26-caggs-signal-hourly.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# CAGG exists
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name='cagg_signal_hourly';"

# No retention policy
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proc_name FROM timescaledb_information.jobs WHERE application_name LIKE '%cagg_signal_hourly%';"
# Expected: only the refresh policy, NO policy_retention
```

## Out of Scope

- Don't add a retention policy here — long-term shape is the entire reason this CAGG exists.
- Don't aggregate text/bool signals — they're categorical; build separate CAGG if needed.
- Don't bucket finer than 1h — Phase 2 spike showed 1h is the sweet spot for storage vs resolution.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/26-caggs-signal-hourly.sql
git commit -m "schema(db-refactor): add cagg_signal_hourly continuous aggregate

ADR-006: replaces mv_signal_stats. Hourly per-(vehicle, signal) numeric
roll-up. No retention — preserves long-term shape after signal_observations'
2-year retention drops raw rows (ADR-002).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-006-pg-functions.md`
- `.github/prompts/db-refactor/adrs/ADR-002-signal-storage-model.md`
