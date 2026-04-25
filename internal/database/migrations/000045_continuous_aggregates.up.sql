-- Migration 000045: Continuous aggregates for dashboard reads
-- Phase-14 prompt 15 — replaces snapshot table reads with efficient cagg queries.
-- Depends on: 000043 (signal_log hypertable)
--
-- Creates 3 continuous aggregates over signal_log:
--   1. cagg_vehicle_daily  — fleet daily stats (battery, odometer, speed, temp)
--   2. cagg_climate_hourly — climate trend pages (inside/outside temp, HVAC, defrost)
--   3. cagg_battery_daily  — battery health / degradation trends

-- 1. Fleet daily stats
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_vehicle_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', created_at) AS bucket,
  vehicle_id,
  last(value_num, created_at) FILTER (WHERE signal = 'BatteryLevel') AS battery_level,
  last(value_num, created_at) FILTER (WHERE signal = 'Odometer') AS odometer,
  avg(value_num) FILTER (WHERE signal = 'VehicleSpeed' AND value_num > 0) AS avg_speed,
  max(value_num) FILTER (WHERE signal = 'VehicleSpeed') AS max_speed,
  avg(value_num) FILTER (WHERE signal = 'OutsideTemp') AS avg_outside_temp,
  avg(value_num) FILTER (WHERE signal = 'InsideTemp') AS avg_inside_temp,
  count(*) FILTER (WHERE signal = 'VehicleSpeed' AND value_num > 0) AS driving_signal_count
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_vehicle_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);

-- 2. Climate hourly (for climate trend pages)
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_climate_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', created_at) AS bucket,
  vehicle_id,
  avg(value_num) FILTER (WHERE signal = 'InsideTemp') AS avg_inside_temp,
  avg(value_num) FILTER (WHERE signal = 'OutsideTemp') AS avg_outside_temp,
  last(value_str, created_at) FILTER (WHERE signal = 'HvacPower') AS hvac_state,
  last(value_bool, created_at) FILTER (WHERE signal = 'DefrostMode') AS defrost_on
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_climate_hourly',
  start_offset => INTERVAL '2 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes'
);

-- 3. Battery health daily (for degradation trend)
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_battery_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', created_at) AS bucket,
  vehicle_id,
  min(value_num) FILTER (WHERE signal = 'BatteryLevel') AS min_soc,
  max(value_num) FILTER (WHERE signal = 'BatteryLevel') AS max_soc,
  last(value_num, created_at) FILTER (WHERE signal = 'BatteryLevel') AS end_soc,
  avg(value_num) FILTER (WHERE signal = 'PackVoltage') AS avg_pack_voltage,
  count(*) FILTER (WHERE signal = 'ACChargingEnergyIn') AS charge_signal_count
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_battery_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);
