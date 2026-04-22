# Grafana → TimescaleDB Query Migration Guide

This guide documents how Grafana dashboard queries should be written now that
the database has been refactored to TimescaleDB hypertables and continuous
aggregates (CAGGs). It is the actionable reference for editing existing
dashboards in `grafana/dashboards/` and for adding new panels.

## What Changed

1. **Datasource** — `grafana/provisioning/datasources/datasources.yml` now sets
   `timescaledb: true`. Grafana automatically rewrites `$__timeGroup(col, $__interval)`
   into `time_bucket($__interval, col)` and the query editor surfaces hypertable
   metadata (chunks, compression, CAGGs).
2. **Hypertables** — `positions`, `charging_telemetry`, `climate_snapshots`,
   `motor_snapshots`, `tire_pressure_snapshots`, `media_snapshots`,
   `security_events`, `safety_snapshots` are TimescaleDB hypertables with
   composite PK `(id, created_at)`.
3. **Continuous aggregates** — pre-computed buckets refreshed automatically:

   | CAGG | Source | Bucket | Retention |
   |------|--------|--------|-----------|
   | `cagg_position_hourly` | `positions` | 1 hour | 1 year |
   | `cagg_position_daily` | `cagg_position_hourly` | 1 day | (no policy) |
   | `cagg_charging_hourly` | `charging_telemetry` | 1 hour | 1 year |
   | `cagg_charging_daily` | `cagg_charging_hourly` | 1 day | 5 years |
   | `cagg_climate_hourly` | `climate_snapshots` | 1 hour | 1 year |
   | `cagg_climate_daily` | `cagg_climate_hourly` | 1 day | 5 years |

   All CAGGs use `bucket` (or `day`) as the timestamp column, NOT `created_at`.
   `$__timeFilter(bucket)` works the same as `$__timeFilter(created_at)`.

## Query Rewrite Decision Tree

```
Is the query a "latest value" lookup (ORDER BY created_at DESC LIMIT 1)?
├── YES → leave unchanged (chunk pruning already finds latest chunk in O(log n))
└── NO  → Does it aggregate by hour/day/week?
         ├── YES → Are the requested columns in a CAGG?
         │        ├── YES → redirect to CAGG (huge speedup)
         │        └── NO  → use time_bucket() on raw table (use $__timeGroup
         │                  with timescaledb: true to get this automatically)
         └── NO  → Is it selecting raw rows over a time range?
                  └── YES → leave unchanged. $__timeFilter() prunes chunks.
                            Add LIMIT if the range can return millions of rows.
```

## Pattern A — `$__timeGroup` (preferred for raw tables)

With `timescaledb: true`, this is automatically rewritten to `time_bucket()`:

```sql
SELECT
  $__timeGroup(created_at, $__interval) AS time,
  AVG(battery_level) AS "Battery"
FROM charging_telemetry
WHERE vehicle_id = ${vehicle_id}
  AND $__timeFilter(created_at)
GROUP BY 1
ORDER BY 1
```

## Pattern B — Direct `time_bucket()` (when interval is fixed)

```sql
SELECT
  time_bucket('1 hour', created_at) AS time,
  COUNT(*) AS "API Calls"
FROM api_call_logs
WHERE $__timeFilter(created_at)
GROUP BY 1
ORDER BY time
```

## Pattern C — Read from a Continuous Aggregate

When the panel only needs columns that exist in a CAGG, prefer the CAGG. It
returns pre-computed values in milliseconds rather than scanning raw chunks.

**Before** (scans up to 365 days of `charging_telemetry`):
```sql
SELECT
  $__timeGroup(created_at, '1d') AS time,
  AVG(battery_level)   AS "Avg Battery",
  AVG(charger_voltage) AS "Avg Voltage",
  AVG(charge_rate_mph) AS "Avg Charge Rate"
FROM charging_telemetry
WHERE vehicle_id = ${vehicle_id}
  AND $__timeFilter(created_at)
GROUP BY 1
ORDER BY 1
```

**After** (reads from `cagg_charging_daily`, ~100x faster):
```sql
SELECT
  day            AS time,
  avg_battery    AS "Avg Battery",
  avg_voltage    AS "Avg Voltage",
  avg_charge_rate AS "Avg Charge Rate"
FROM cagg_charging_daily
WHERE vehicle_id = ${vehicle_id}
  AND $__timeFilter(day)
ORDER BY day
```

### CAGG Column Reference

| CAGG | Time col | Available columns |
|------|----------|-------------------|
| `cagg_position_hourly` | `bucket` | avg/min/max_speed, avg/min/max_power, avg/min/max_battery, avg_lat, avg_lng, avg_inside_temp, avg_outside_temp, sample_count |
| `cagg_position_daily` | `day` | same as hourly + sum(sample_count) |
| `cagg_charging_hourly` | `bucket` | avg/min/max_battery, avg/max_voltage, avg/max_charge_rate, avg/max_dc_power, avg_time_to_full, sample_count |
| `cagg_charging_daily` | `day` | same as hourly + sum(sample_count) |
| `cagg_climate_hourly` | `bucket` | avg/min/max_inside_temp, avg/min/max_outside_temp, avg_fan_speed, ac_on_samples, sample_count |
| `cagg_climate_daily` | `day` | same as hourly + sum(sample_count) |

If your panel needs a column NOT in this list (e.g. `pack_voltage`,
`brick_voltage_max`, `seat_heater_left`), you must query the raw hypertable.

## Pattern D — Latest Value (no change required)

```sql
SELECT battery_level FROM positions
WHERE vehicle_id = ${vehicle_id}
ORDER BY created_at DESC LIMIT 1
```

TimescaleDB's chunk pruning makes this O(log n) — it only scans the most recent
chunk. Composite index `(vehicle_id, created_at DESC)` already exists.

## When NOT to migrate to a CAGG

- **Raw column projections** — panels that select detail columns
  (`brick_voltage_max`, `pack_current`, `hvac_steering_wheel_heat_level`, etc.)
  must query the hypertable; the CAGG only stores aggregates of a few signals.
- **Joins to non-hypertables** — drives, charging_sessions, vehicles all
  remain in standard PostgreSQL tables.
- **Per-row analytics** — anomaly detection, drive segmentation, stop-detection
  algorithms need the raw row stream.

## Verification Checklist When Editing a Panel

1. `$__timeFilter(<col>)` is present so chunk pruning works.
2. Aggregating queries use `$__timeGroup` or `time_bucket`, never `date_trunc`.
3. Long-range aggregates (>30 days) read from a CAGG when the columns are
   available.
4. Detail/raw queries include either a `LIMIT` or an upper bound on the time
   range.
5. Panel renders in Grafana → Query Inspector → "rows returned > 0".
