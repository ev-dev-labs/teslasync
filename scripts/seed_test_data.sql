-- ============================================================
-- TeslaSync Large Test Data Seed Script
-- Generates ~2 years of realistic Tesla Model Y driving data
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CLEANUP: Truncate all data tables (preserve schema/settings)
-- ============================================================
TRUNCATE TABLE
  drive_telemetry_readings,
  charge_telemetry_readings,
  positions,
  motor_snapshots,
  climate_snapshots,
  charging_telemetry,
  charging_sessions,
  drives,
  daily_mileage,
  battery_snapshots,
  vampire_drain_events,
  tire_pressure_snapshots,
  safety_snapshots,
  location_snapshots,
  media_snapshots,
  vehicle_states,
  alerts,
  api_call_logs,
  audit_logs,
  security_events,
  software_updates,
  command_logs,
  vehicle_live_state,
  signal_history
CASCADE;

-- Keep vehicle, settings, tokens, geofences, etc.

-- ============================================================
-- 2. SETTINGS: Ensure proper config for TCO calculations
-- ============================================================
INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language,
  base_cost_per_kwh, gas_price_per_unit, gas_unit, gas_efficiency_mpg, decimal_precision)
VALUES (1, 'km', 'C', 'rated', 'en', 0.14, 3.96, 'gallon', 25, 1)
ON CONFLICT (id) DO UPDATE SET
  base_cost_per_kwh = 0.14,
  gas_price_per_unit = 3.96,
  gas_efficiency_mpg = 25;

-- ============================================================
-- 3. VEHICLE: Ensure test vehicle exists
-- ============================================================
-- Vehicle already exists (id=1, vehicle_id=1098765432) — just update display name
UPDATE vehicles SET display_name = 'Test Model Y' WHERE id = 1;

-- ============================================================
-- 4. VEHICLE LIVE STATE
-- ============================================================
INSERT INTO vehicle_live_state (vehicle_id, latitude, longitude, heading, speed, power, odometer,
  battery_level, soc, ideal_range, rated_range, est_range, energy_remaining,
  inside_temp, outside_temp, gear, locked, sentry_mode,
  tire_pressure_fl, tire_pressure_fr, tire_pressure_rl, tire_pressure_rr,
  vehicle_name, car_type, version, updated_at)
VALUES (1, 40.7128, -74.0060, 180, 0, 0, 72450.5,
  80, 80.0, 340.0, 320.0, 310.0, 60.5,
  22.0, 15.0, 'P', true, false,
  2.9, 2.9, 2.85, 2.85,
  'Test Model Y', 'modely', '2025.8.5', NOW())
ON CONFLICT (vehicle_id) DO UPDATE SET
  odometer = 72450.5, battery_level = 80, updated_at = NOW();

-- ============================================================
-- 5. DRIVES: ~6000 drives over 2 years (avg 8/day)
-- ============================================================
INSERT INTO drives (vehicle_id, start_date, end_date, distance, duration_min,
  speed_max, speed_avg, power_max, power_min,
  start_battery_level, end_battery_level,
  start_range_km, end_range_km,
  inside_temp_avg, outside_temp_avg,
  start_odometer, end_odometer,
  start_rated_range_km, end_rated_range_km)
SELECT
  1,
  ts,
  ts + (dur || ' minutes')::interval,
  dist,
  dur,
  speed_max,
  speed_avg,
  power_max,
  power_min,
  start_bat,
  GREATEST(start_bat - bat_used, 5),
  start_bat * 4.0,
  GREATEST(start_bat - bat_used, 5) * 4.0,
  20 + 4 * random(),
  -- Seasonal outside temp: colder in winter, warmer in summer
  10 + 15 * sin(2 * pi() * (EXTRACT(DOY FROM ts) - 80) / 365) + 5 * (random() - 0.5),
  odo_start,
  odo_start + dist,
  start_bat * 4.0,
  GREATEST(start_bat - bat_used, 5) * 4.0
FROM (
  SELECT
    '2024-04-01'::timestamptz + (n * 2.8 || ' hours')::interval
      + (random() * 60 || ' minutes')::interval AS ts,
    2 + random() * 45 AS dist,
    5 + random() * 55 AS dur,
    40 + random() * 90 AS speed_max,
    15 + random() * 50 AS speed_avg,
    30 + random() * 200 AS power_max,
    -10 - random() * 60 AS power_min,
    40 + floor(random() * 55)::int AS start_bat,
    2 + floor(random() * 15)::int AS bat_used,
    10000 + n * 12.0 AS odo_start,
    n
  FROM generate_series(0, 5999) AS n
) sub;

-- ============================================================
-- 6. CHARGING SESSIONS: ~1200 sessions over 2 years
-- ============================================================
INSERT INTO charging_sessions (vehicle_id, start_date, end_date,
  charge_energy_added, start_battery_level, end_battery_level,
  start_range_km, end_range_km,
  charger_voltage, charger_actual_current, charger_power, charger_phases,
  fast_charger_type, conn_charge_cable, cost, duration_min,
  latitude, longitude, location_name,
  inside_temp_avg, outside_temp_avg)
SELECT
  1,
  ts,
  ts + (dur || ' minutes')::interval,
  energy,
  start_bat,
  LEAST(start_bat + bat_gain, 100),
  start_bat * 4.0,
  LEAST(start_bat + bat_gain, 100) * 4.0,
  CASE WHEN is_dc THEN 400 ELSE 240 END,
  CASE WHEN is_dc THEN 250 ELSE 32 END,
  CASE WHEN is_dc THEN 50 + random() * 200 ELSE 7 + random() * 4 END,
  CASE WHEN is_dc THEN 3 ELSE 1 END,
  CASE WHEN is_dc THEN 'Tesla Supercharger' ELSE NULL END,
  CASE WHEN is_dc THEN 'IEC' ELSE 'SAE' END,
  energy * CASE WHEN is_dc THEN 0.35 ELSE 0.14 END,
  dur,
  40.71 + random() * 0.1,
  -74.01 + random() * 0.1,
  CASE WHEN is_dc THEN 'Supercharger - Location ' || n ELSE 'Home' END,
  21 + random() * 3,
  10 + 15 * sin(2 * pi() * (EXTRACT(DOY FROM ts) - 80) / 365) + 3 * random()
FROM (
  SELECT
    '2024-04-01'::timestamptz + (n * 14.6 || ' hours')::interval
      + (random() * 120 || ' minutes')::interval AS ts,
    20 + random() * 200 AS dur,
    5 + random() * 55 AS energy,
    15 + floor(random() * 45)::int AS start_bat,
    20 + floor(random() * 60)::int AS bat_gain,
    random() < 0.25 AS is_dc,
    n
  FROM generate_series(0, 1199) AS n
) sub;

-- ============================================================
-- 7. CHARGING TELEMETRY: ~5000 readings
-- ============================================================
INSERT INTO charging_telemetry (vehicle_id, battery_level, soc,
  charge_state, detailed_charge_state,
  charge_limit_soc, charge_amps, charger_voltage,
  pack_voltage, pack_current, energy_remaining,
  est_battery_range, ideal_battery_range, rated_range,
  brick_voltage_max, brick_voltage_min,
  num_brick_voltage_max, num_brick_voltage_min,
  module_temp_max, module_temp_min,
  num_module_temp_max, num_module_temp_min,
  battery_heater_on, bms_state,
  created_at)
SELECT
  1,
  bat_level,
  bat_level::float,
  CASE WHEN random() < 0.7 THEN 'Charging' ELSE 'Complete' END,
  CASE WHEN random() < 0.7 THEN 'charging' ELSE 'charge_complete' END,
  90,
  16 + random() * 32,
  CASE WHEN random() < 0.3 THEN 400 ELSE 240 END,
  380 + random() * 20,
  CASE WHEN random() < 0.7 THEN 10 + random() * 40 ELSE 0 END,
  bat_level * 0.75,
  bat_level * 3.0 + random() * 10,
  bat_level * 3.8 + random() * 10,
  bat_level * 3.5 + random() * 10,
  4.15 + random() * 0.07,
  4.08 + random() * 0.07,
  1 + floor(random() * 5)::int,
  1 + floor(random() * 5)::int,
  25 + random() * 10,
  22 + random() * 8,
  1 + floor(random() * 4)::int,
  1 + floor(random() * 4)::int,
  random() < 0.1,
  'standby',
  '2024-04-01'::timestamptz + (n * 3.5 || ' hours')::interval + (random() * 60 || ' minutes')::interval
FROM (
  SELECT n, 20 + floor(random() * 75)::int AS bat_level
  FROM generate_series(0, 4999) AS n
) sub;

-- ============================================================
-- 8. DAILY MILEAGE: every day for 2 years (730 days)
-- ============================================================
INSERT INTO daily_mileage (vehicle_id, date, odometer_start, odometer_end, distance_km)
SELECT
  1,
  d::date,
  10000 + n * 100.0,
  10000 + n * 100.0 + 20 + random() * 180,
  20 + random() * 180
FROM (
  SELECT generate_series('2024-04-01'::date, '2026-04-01'::date, '1 day') AS d,
         generate_series(0, 730) AS n
) sub
WHERE d::date = '2024-04-01'::date + (n || ' days')::interval;

-- ============================================================
-- 9. MOTOR SNAPSHOTS: ~10000 (motor telemetry over 2 years)
-- ============================================================
INSERT INTO motor_snapshots (vehicle_id, di_state, di_torque, di_axle_speed,
  di_stator_temp, pedal_position, brake_pedal,
  lateral_accel, longitudinal_accel, vehicle_speed, gear,
  di_torque_actual_f, di_torque_actual_r,
  di_stator_temp_f, di_heatsink_t_f, di_heatsink_t_r,
  di_inverter_t_f, di_inverter_t_r,
  created_at)
SELECT
  1,
  CASE WHEN random() < 0.7 THEN 'drive' WHEN random() < 0.9 THEN 'ready' ELSE 'standby' END,
  random() * 350,
  random() * 12000,
  40 + random() * 80,
  random() * 85,
  random() < 0.15,
  (random() - 0.5) * 0.8,
  (random() - 0.5) * 1.2,
  random() * 130,
  CASE WHEN random() < 0.85 THEN 'D' WHEN random() < 0.95 THEN 'P' WHEN random() < 0.98 THEN 'R' ELSE 'N' END,
  random() * 180,
  random() * 250,
  38 + random() * 70,
  30 + random() * 50,
  30 + random() * 50,
  35 + random() * 60,
  35 + random() * 60,
  '2024-04-01'::timestamptz + (n * 1.75 || ' hours')::interval + (random() * 30 || ' minutes')::interval
FROM generate_series(0, 9999) AS n;

-- ============================================================
-- 10. CLIMATE SNAPSHOTS: ~5000
-- ============================================================
INSERT INTO climate_snapshots (vehicle_id, inside_temp, outside_temp,
  hvac_power, hvac_fan_speed,
  hvac_left_temp_request, hvac_right_temp_request,
  cabin_overheat_mode, defrost_mode, battery_heater_on,
  created_at)
SELECT
  1,
  18 + random() * 8,
  5 + 20 * sin(2 * pi() * (EXTRACT(DOY FROM ts) - 80) / 365) + 5 * random(),
  CASE WHEN random() < 0.6 THEN 1.5 + random() * 5.0 ELSE 0 END,
  floor(random() * 8)::int,
  20 + random() * 4,
  20 + random() * 4,
  CASE WHEN random() < 0.3 THEN 'On' ELSE 'Off' END,
  CASE WHEN random() < 0.1 THEN 'On' ELSE 'Off' END,
  random() < 0.1,
  ts
FROM (
  SELECT '2024-04-01'::timestamptz + (n * 3.5 || ' hours')::interval + (random() * 30 || ' minutes')::interval AS ts
  FROM generate_series(0, 4999) AS n
) sub;

-- ============================================================
-- 11. BATTERY SNAPSHOTS: monthly ~24 readings
-- ============================================================
INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh,
  degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
SELECT
  1,
  100 - n * 0.35,
  75 - n * 0.08,
  1.5 + n * 0.35,
  350 - n * 3.5,
  200 + n * 25,
  22 + random() * 8,
  '2024-04-01'::timestamptz + (n || ' months')::interval + (random() * 15 || ' days')::interval
FROM generate_series(0, 23) AS n;

-- ============================================================
-- 12. VAMPIRE DRAIN EVENTS: ~500
-- ============================================================
INSERT INTO vampire_drain_events (vehicle_id,
  start_date, end_date, start_battery, end_battery,
  battery_lost, range_lost_km, duration_hours,
  drain_rate_pct_per_hour, outside_temp_avg, sentry_mode)
SELECT
  1,
  ts,
  ts + (dur || ' hours')::interval,
  start_bat,
  GREATEST(start_bat - drain_amt, 5),
  drain_amt,
  drain_amt * 4.0,
  dur,
  drain_amt / dur,
  5 + 20 * sin(2 * pi() * (EXTRACT(DOY FROM ts) - 80) / 365) + 5 * random(),
  random() < 0.3
FROM (
  SELECT
    '2024-04-01'::timestamptz + (n * 35 || ' hours')::interval + (random() * 120 || ' minutes')::interval AS ts,
    4 + random() * 20 AS dur,
    60 + floor(random() * 35)::int AS start_bat,
    1 + floor(random() * 5)::int AS drain_amt
  FROM generate_series(0, 499) AS n
) sub;

-- ============================================================
-- 13. TIRE PRESSURE SNAPSHOTS: ~1500
-- ============================================================
INSERT INTO tire_pressure_snapshots (vehicle_id,
  front_left, front_right, rear_left, rear_right,
  created_at)
SELECT
  1,
  2.7 + random() * 0.5,
  2.7 + random() * 0.5,
  2.65 + random() * 0.5,
  2.65 + random() * 0.5,
  '2024-04-01'::timestamptz + (n * 11.7 || ' hours')::interval
FROM generate_series(0, 1499) AS n;

-- ============================================================
-- 14. SOFTWARE UPDATES: 12 updates
-- ============================================================
INSERT INTO software_updates (vehicle_id, version, status, installed_at, created_at)
SELECT
  1,
  '2024.' || (3 + n) || '.' || floor(random() * 10)::int,
  'installed',
  '2024-04-01'::timestamptz + (n * 60 || ' days')::interval,
  '2024-04-01'::timestamptz + (n * 60 || ' days')::interval - interval '2 hours'
FROM generate_series(0, 11) AS n;

-- ============================================================
-- 15. SAFETY SNAPSHOTS: ~800
-- ============================================================
INSERT INTO safety_snapshots (vehicle_id,
  automatic_blind_spot_camera, automatic_emergency_braking_off,
  blind_spot_collision_warning, cruise_follow_distance,
  emergency_lane_departure_avoidance, forward_collision_warning,
  lane_departure_avoidance, speed_limit_warning,
  created_at)
SELECT
  1,
  random() > 0.5,
  random() < 0.05,
  CASE WHEN random() < 0.8 THEN 'On' ELSE 'Off' END,
  CASE floor(random()*3)::int WHEN 0 THEN '1' WHEN 1 THEN '3' ELSE '7' END,
  random() > 0.1,
  CASE WHEN random() < 0.8 THEN 'On' ELSE 'Off' END,
  CASE WHEN random() < 0.8 THEN 'On' ELSE 'Off' END,
  CASE WHEN random() < 0.6 THEN 'Display' ELSE 'Off' END,
  '2024-04-01'::timestamptz + (n * 22 || ' hours')::interval
FROM generate_series(0, 799) AS n;

-- ============================================================
-- 16. CHARGE TELEMETRY READINGS (per-session): ~3000
-- ============================================================
INSERT INTO charge_telemetry_readings (session_id, vehicle_id,
  battery_level, soc, power_kw, voltage, current_amps, phases,
  energy_added, rated_range, ideal_range, est_range,
  inside_temp, outside_temp, battery_temp,
  created_at)
SELECT
  cs.id,
  1,
  30 + floor(random() * 60)::int,
  30 + random() * 60,
  5 + random() * 150,
  220 + random() * 200,
  10 + random() * 40,
  CASE WHEN random() < 0.3 THEN 3 ELSE 1 END,
  random() * 50,
  190 + random() * 140,
  200 + random() * 150,
  180 + random() * 130,
  20 + random() * 5,
  5 + 15 * random(),
  22 + random() * 15,
  cs.start_date + (gs.r * (COALESCE(EXTRACT(EPOCH FROM cs.end_date - cs.start_date), 3600) / 3) || ' seconds')::interval
FROM (
  SELECT id, start_date, end_date, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM charging_sessions
) cs
CROSS JOIN (SELECT generate_series(0, 2) AS r) gs
WHERE cs.rn <= 1000;

COMMIT;

-- Final stats
SELECT 'drives' AS tbl, COUNT(*) FROM drives
UNION ALL SELECT 'charging_sessions', COUNT(*) FROM charging_sessions
UNION ALL SELECT 'charging_telemetry', COUNT(*) FROM charging_telemetry
UNION ALL SELECT 'motor_snapshots', COUNT(*) FROM motor_snapshots
UNION ALL SELECT 'climate_snapshots', COUNT(*) FROM climate_snapshots
UNION ALL SELECT 'daily_mileage', COUNT(*) FROM daily_mileage
UNION ALL SELECT 'battery_snapshots', COUNT(*) FROM battery_snapshots
UNION ALL SELECT 'vampire_drain_events', COUNT(*) FROM vampire_drain_events
UNION ALL SELECT 'tire_pressure_snapshots', COUNT(*) FROM tire_pressure_snapshots
UNION ALL SELECT 'software_updates', COUNT(*) FROM software_updates
UNION ALL SELECT 'safety_snapshots', COUNT(*) FROM safety_snapshots
UNION ALL SELECT 'charge_telemetry_readings', COUNT(*) FROM charge_telemetry_readings
ORDER BY 1;
