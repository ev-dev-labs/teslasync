-- Migration 33: Create enriched views for drives and charging_sessions
-- These views replace 0 values with NULL so Grafana dashboards don't show
-- false zeros for battery, SOC, range, odometer when signals were missing.

CREATE OR REPLACE VIEW v_drives AS
SELECT
  id, vehicle_id, start_date, end_date,
  start_position_id, end_position_id,
  start_address_id, end_address_id,
  distance, duration_min,
  NULLIF(start_range_km, 0) AS start_range_km,
  NULLIF(end_range_km, 0) AS end_range_km,
  speed_max, power_max, power_min,
  NULLIF(start_battery_level, 0) AS start_battery_level,
  NULLIF(end_battery_level, 0) AS end_battery_level,
  inside_temp_avg, outside_temp_avg,
  NULLIF(start_odometer, 0) AS start_odometer,
  NULLIF(end_odometer, 0) AS end_odometer,
  speed_avg, speed_min,
  NULLIF(start_rated_range_km, 0) AS start_rated_range_km,
  NULLIF(end_rated_range_km, 0) AS end_rated_range_km,
  rated_range_avg, rated_range_max, rated_range_min,
  NULLIF(start_ideal_range_km, 0) AS start_ideal_range_km,
  NULLIF(end_ideal_range_km, 0) AS end_ideal_range_km,
  ideal_range_avg, ideal_range_max, ideal_range_min,
  NULLIF(start_est_range_km, 0) AS start_est_range_km,
  NULLIF(end_est_range_km, 0) AS end_est_range_km,
  est_range_avg, est_range_max, est_range_min,
  NULLIF(soc_start, 0) AS soc_start,
  NULLIF(soc_end, 0) AS soc_end,
  soc_avg, soc_max, soc_min,
  NULLIF(usable_soc_start, 0) AS usable_soc_start,
  NULLIF(usable_soc_end, 0) AS usable_soc_end,
  usable_soc_avg, usable_soc_max, usable_soc_min,
  NULLIF(elevation_start, 0) AS elevation_start,
  NULLIF(elevation_end, 0) AS elevation_end,
  elevation_gain, elevation_loss,
  driver_temp_avg, passenger_temp_avg, battery_heater_on,
  start_address, end_address,
  start_latitude, start_longitude,
  end_latitude, end_longitude
FROM drives;

CREATE OR REPLACE VIEW v_charging_sessions AS
SELECT
  id, vehicle_id, start_date, end_date, address_id,
  charge_energy_added, charge_energy_used,
  NULLIF(start_battery_level, 0) AS start_battery_level,
  NULLIF(end_battery_level, 0) AS end_battery_level,
  NULLIF(start_range_km, 0) AS start_range_km,
  NULLIF(end_range_km, 0) AS end_range_km,
  charger_phases, charger_voltage, charger_actual_current, charger_power,
  fast_charger_type, fast_charger_brand, conn_charge_cable,
  cost, duration_min,
  latitude, longitude, location_name,
  inside_temp_avg, outside_temp_avg
FROM charging_sessions;
