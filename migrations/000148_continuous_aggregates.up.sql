-- TimescaleDB continuous aggregates — real-time analytics for dashboards.
--
-- Replaces the manual materialized-view pattern (mv_position_hourly) and the
-- on-the-fly analytics SQL (40+ fn_* functions that scan raw telemetry on
-- every dashboard load) with pre-computed, incrementally-refreshed aggregates.
--
-- Benefits vs. REFRESH MATERIALIZED VIEW:
--   * Incremental — only processes new rows, not a full recompute
--   * Real-time — queries combine materialized + recent unmaterialized rows
--   * Policy-driven — TimescaleDB background worker handles refresh, no Go
--     scheduler / maintenance_worker call needed
--   * Cascading — hourly → daily aggregates compose without custom code
--
-- Prerequisites (already in place):
--   * 000145: source tables are hypertables on created_at
--   * 000146: compression enabled with vehicle_id segmentby (CAGG refresh
--     windows sit inside the 7-day uncompressed zone, so they don't conflict)

SET statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- Replace the manual mv_position_hourly with a continuous aggregate.
-- The manual MV required a REFRESH CONCURRENTLY in maintenance_worker.go;
-- the CAGG refreshes itself every 15 minutes via a TimescaleDB policy.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_position_hourly CASCADE;

CREATE MATERIALIZED VIEW cagg_position_hourly
WITH (timescaledb.continuous) AS
SELECT
    vehicle_id,
    time_bucket(INTERVAL '1 hour', created_at) AS bucket,
    avg(speed)         AS avg_speed,
    max(speed)         AS max_speed,
    avg(power)         AS avg_power,
    min(power)         AS min_power,
    max(power)         AS max_power,
    avg(battery_level) AS avg_battery,
    min(battery_level) AS min_battery,
    max(battery_level) AS max_battery,
    avg(latitude)      AS avg_lat,
    avg(longitude)     AS avg_lng,
    avg(inside_temp)   AS avg_inside_temp,
    avg(outside_temp)  AS avg_outside_temp,
    count(*)           AS sample_count
FROM positions
GROUP BY vehicle_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_position_hourly',
    start_offset      => INTERVAL '3 hours',
    end_offset        => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists     => true);

-- ---------------------------------------------------------------------------
-- Charging telemetry — hourly summary used by charging dashboards.
-- Only aggregates columns that survived the JSONB consolidation (migration
-- 000144); all other charging signals live in charging_telemetry.signals and
-- are queried ad-hoc when needed.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW cagg_charging_hourly
WITH (timescaledb.continuous) AS
SELECT
    vehicle_id,
    time_bucket(INTERVAL '1 hour', created_at) AS bucket,
    avg(battery_level)        AS avg_battery,
    min(battery_level)        AS min_battery,
    max(battery_level)        AS max_battery,
    avg(charger_voltage)      AS avg_voltage,
    max(charger_voltage)      AS max_voltage,
    avg(charge_rate_mph)      AS avg_charge_rate,
    max(charge_rate_mph)      AS max_charge_rate,
    avg(dc_charging_power)    AS avg_dc_power,
    max(dc_charging_power)    AS max_dc_power,
    avg(time_to_full_charge)  AS avg_time_to_full,
    count(*)                  AS sample_count
FROM charging_telemetry
GROUP BY vehicle_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_charging_hourly',
    start_offset      => INTERVAL '3 hours',
    end_offset        => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists     => true);

-- ---------------------------------------------------------------------------
-- Climate — hourly summary for HVAC / cabin temp dashboards.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW cagg_climate_hourly
WITH (timescaledb.continuous) AS
SELECT
    vehicle_id,
    time_bucket(INTERVAL '1 hour', created_at) AS bucket,
    avg(inside_temp)                                          AS avg_inside_temp,
    min(inside_temp)                                          AS min_inside_temp,
    max(inside_temp)                                          AS max_inside_temp,
    avg(outside_temp)                                         AS avg_outside_temp,
    min(outside_temp)                                         AS min_outside_temp,
    max(outside_temp)                                         AS max_outside_temp,
    avg(hvac_fan_speed)                                       AS avg_fan_speed,
    count(*) FILTER (WHERE hvac_ac_enabled)                   AS ac_on_samples,
    count(*)                                                  AS sample_count
FROM climate_snapshots
GROUP BY vehicle_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_climate_hourly',
    start_offset      => INTERVAL '3 hours',
    end_offset        => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists     => true);

-- ---------------------------------------------------------------------------
-- Daily vehicle summary — hierarchical (cascading) CAGG built from the hourly
-- position aggregate. Refreshing this does not re-scan the positions
-- hypertable; it only reads from cagg_position_hourly's materialization table.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW cagg_position_daily
WITH (timescaledb.continuous) AS
SELECT
    vehicle_id,
    time_bucket(INTERVAL '1 day', bucket) AS day,
    avg(avg_speed)         AS avg_speed,
    max(max_speed)         AS max_speed,
    avg(avg_power)         AS avg_power,
    min(min_power)         AS min_power,
    max(max_power)         AS max_power,
    avg(avg_battery)       AS avg_battery,
    min(min_battery)       AS min_battery,
    max(max_battery)       AS max_battery,
    avg(avg_inside_temp)   AS avg_inside_temp,
    avg(avg_outside_temp)  AS avg_outside_temp,
    sum(sample_count)      AS sample_count
FROM cagg_position_hourly
GROUP BY vehicle_id, day
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_position_daily',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => true);

-- ---------------------------------------------------------------------------
-- Fleet-wide weekly summary — implemented as a plain VIEW (not a CAGG) because
-- count(DISTINCT) is not supported inside continuous aggregates. Queries still
-- benefit from cagg_position_daily's pre-computed daily rollup, so this view
-- only touches one row per vehicle per day instead of raw telemetry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fleet_weekly AS
SELECT
    time_bucket(INTERVAL '7 days', day) AS week,
    count(DISTINCT vehicle_id)          AS vehicle_count,
    sum(sample_count)                   AS total_samples,
    avg(avg_battery)                    AS fleet_avg_battery,
    min(min_battery)                    AS fleet_min_battery,
    max(max_battery)                    AS fleet_max_battery,
    avg(avg_speed)                      AS fleet_avg_speed,
    avg(avg_outside_temp)               AS fleet_avg_outside_temp
FROM cagg_position_daily
GROUP BY week;

-- ---------------------------------------------------------------------------
-- Retention — let aggregates live longer than the raw data they summarize.
-- (Raw retention is configured separately in prompt 06.)
-- ---------------------------------------------------------------------------
SELECT add_retention_policy('cagg_position_hourly', INTERVAL '1 year',
    if_not_exists => true);
SELECT add_retention_policy('cagg_charging_hourly', INTERVAL '1 year',
    if_not_exists => true);
SELECT add_retention_policy('cagg_climate_hourly',  INTERVAL '1 year',
    if_not_exists => true);
-- cagg_position_daily kept indefinitely (cheap — one row per vehicle per day)
