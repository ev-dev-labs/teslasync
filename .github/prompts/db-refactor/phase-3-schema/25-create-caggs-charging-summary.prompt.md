---
description: "Phase 3 — Create cagg_charging_summary continuous aggregate (per-session charging roll-up)"
---

# 🟢 Schema 25 — `cagg_charging_summary` Continuous Aggregate

> **Severity:** Standard
> **Priority:** Medium
> **Category:** Phase 3 — Schema (continuous aggregate)
> **Prompt #:** 26 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/25-caggs-charging-summary.sql` |
| Depends on | `04-create-charging-telemetry-hypertable`, `12-create-charging-sessions` |
| Blocks | (none) |
| ADR refs | ADR-006 |
| Estimated effort | small (~25 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/25-caggs-charging-summary.sql` containing one continuous aggregate `cagg_charging_summary` (hourly charging-session metrics roll-up).

## What's Being Established

ADR-006 converts `fn_charging_calendar_heatmap`, `fn_charging_hourly_distribution`, `fn_charging_power_timeline` into a single hourly CAGG over `charging_telemetry`. Dashboards read this directly as a view.

## Recommendation

- Hourly bucket over `charging_telemetry`
- Aggregate by `(vehicle_id, session_id, hour)` so dashboards can group by either
- Refresh hourly, last 24h end offset (catches mid-session updates)

## Output (full file contents)

```sql
-- =========================================================================
-- 25 — cagg_charging_summary (hourly charging telemetry roll-up)
-- ADR-006: replaces fn_charging_calendar_heatmap, fn_charging_hourly_distribution,
-- fn_charging_power_timeline.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_charging_summary
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  session_id,
  time_bucket('1 hour', ts)  AS hour,
  count(*)                    AS sample_count,
  avg(charger_power_kw)       AS avg_power_kw,
  max(charger_power_kw)       AS peak_power_kw,
  avg(charger_voltage)        AS avg_voltage,
  avg(charger_actual_current) AS avg_current,
  max(charge_energy_added_kwh) - min(charge_energy_added_kwh) AS energy_added_kwh,
  max(charge_miles_added)     - min(charge_miles_added)        AS miles_added,
  min(battery_level)          AS start_soc,
  max(battery_level)          AS end_soc
FROM charging_telemetry
GROUP BY vehicle_id, session_id, hour
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW cagg_charging_summary IS
  'Hourly per-session charging roll-up. ADR-006 — replaces 3 fn_charging_* functions.';

SELECT add_continuous_aggregate_policy('cagg_charging_summary',
  start_offset      => interval '14 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');
```

## Suggested Fix

1. Confirm `charging_telemetry` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] CAGG `cagg_charging_summary` registered
- [ ] Refresh policy schedule_interval = 1 hour, start_offset = 14 days, end_offset = 1 hour
- [ ] CAGG groups by (vehicle_id, session_id, hour)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\25-caggs-charging-summary.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name='cagg_charging_summary';"

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proc_name, config FROM timescaledb_information.jobs WHERE application_name LIKE '%cagg_charging_summary%';"
```

## Out of Scope

- Don't compute cost in the CAGG — cost depends on TOU electricity_cost rows; computed in Go.
- Don't add per-charger-type aggregates here — separate CAGG if needed later.
- Don't refresh here — operational concern.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/25-caggs-charging-summary.sql
git commit -m "schema(db-refactor): add cagg_charging_summary continuous aggregate

ADR-006: replaces fn_charging_calendar_heatmap, fn_charging_hourly_distribution,
fn_charging_power_timeline. Hourly per-session metrics, refresh hourly.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-006-pg-functions.md`
