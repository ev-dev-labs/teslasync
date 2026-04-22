-- Add cascading daily continuous aggregates that roll up the existing hourly caggs
-- (cagg_charging_hourly, cagg_climate_hourly) into daily buckets.
--
-- The hourly position cagg already has a daily roll-up (cagg_position_daily); this
-- migration completes the pattern for charging and climate so dashboards that
-- visualize >30 days of history hit a pre-aggregated table instead of the raw
-- hypertables.
--
-- Note on cagg_fleet_weekly: the original prompt suggested a fleet-wide weekly
-- cagg using count(DISTINCT vehicle_id), but TimescaleDB continuous aggregates
-- do not support DISTINCT aggregates. The existing v_fleet_weekly view (defined
-- in baseline) computes the same thing on demand from cagg_position_daily and is
-- already cheap because the underlying cagg is materialized.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.cagg_charging_daily
WITH (timescaledb.continuous) AS
SELECT vehicle_id,
    public.time_bucket('1 day'::interval, bucket) AS day,
    avg(avg_battery)        AS avg_battery,
    min(min_battery)        AS min_battery,
    max(max_battery)        AS max_battery,
    avg(avg_voltage)        AS avg_voltage,
    max(max_voltage)        AS max_voltage,
    avg(avg_charge_rate)    AS avg_charge_rate,
    max(max_charge_rate)    AS max_charge_rate,
    avg(avg_dc_power)       AS avg_dc_power,
    max(max_dc_power)       AS max_dc_power,
    avg(avg_time_to_full)   AS avg_time_to_full,
    sum(sample_count)       AS sample_count
FROM public.cagg_charging_hourly
GROUP BY vehicle_id, public.time_bucket('1 day'::interval, bucket)
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.cagg_climate_daily
WITH (timescaledb.continuous) AS
SELECT vehicle_id,
    public.time_bucket('1 day'::interval, bucket) AS day,
    avg(avg_inside_temp)   AS avg_inside_temp,
    min(min_inside_temp)   AS min_inside_temp,
    max(max_inside_temp)   AS max_inside_temp,
    avg(avg_outside_temp)  AS avg_outside_temp,
    min(min_outside_temp)  AS min_outside_temp,
    max(max_outside_temp)  AS max_outside_temp,
    avg(avg_fan_speed)     AS avg_fan_speed,
    sum(ac_on_samples)     AS ac_on_samples,
    sum(sample_count)      AS sample_count
FROM public.cagg_climate_hourly
GROUP BY vehicle_id, public.time_bucket('1 day'::interval, bucket)
WITH NO DATA;

-- Refresh policies: cascading caggs lag the hourly refresh by 1 hour so they
-- always operate on already-materialized data.
SELECT public.add_continuous_aggregate_policy('public.cagg_charging_daily',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

SELECT public.add_continuous_aggregate_policy('public.cagg_climate_daily',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

-- Retention policies: keep daily roll-ups for 5 years (vs 1 year for hourly).
SELECT public.add_retention_policy('public.cagg_charging_daily', INTERVAL '5 years', if_not_exists => TRUE);
SELECT public.add_retention_policy('public.cagg_climate_daily',  INTERVAL '5 years', if_not_exists => TRUE);
