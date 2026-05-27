-- TeslaSync Comprehensive Seed Data
-- Generates realistic Tesla Model Y data from 2020-01-01 to 2026-03-31
-- Run: docker cp db/seeds/seed_comprehensive.sql teslasync-postgres:/tmp/seed.sql
--      docker exec teslasync-postgres psql -U teslasync -d teslasync -f /tmp/seed.sql
BEGIN;

-- ============================================================
-- CLEANUP: Truncate all tables in dependency order
-- ============================================================
TRUNCATE TABLE
  notification_logs, notification_metrics, notification_preferences, notification_schedules,
  notification_channels, charging_telemetry, motor_snapshots, climate_snapshots,
  security_events, location_snapshots, media_snapshots, safety_snapshots,
  user_preference_snapshots, vehicle_config_snapshots, tire_pressure_snapshots,
  trip_drives, trips, visited_locations, daily_mileage, vampire_drain_events,
  vehicle_states, battery_snapshots, command_logs, alerts, alert_rules,
  api_call_logs, audit_logs, api_keys, export_jobs, chatbot_messages,
  software_updates, gas_price_history, geofence_electricity_rates, geofences,
  drives, charging_sessions, positions, addresses, tokens, settings,
  tesla_public_key, gas_price_poll_state, vehicles
CASCADE;

-- ============================================================
-- 1. VEHICLE
-- ============================================================
INSERT INTO vehicles (id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, created_at, updated_at)
VALUES (1, 1098765432, 'TESTVIN0000000001', 'Test Model Y', 'Model Y', 'Long Range', 'PearlWhite', 'Gemini19', 'online', true, '2020-01-01'::timestamptz, NOW());
SELECT setval('vehicles_id_seq', 1);

-- ============================================================
-- 2. TOKENS (single row, expires 30 days from now)
-- ============================================================
INSERT INTO tokens (id, access_token, refresh_token, expires_at, created_at, updated_at)
VALUES (1,
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXNsYXN5bmMtc2VlZCIsInN1YiI6InRlc3R1c2VyIiwiZXhwIjoxNzQzMDAwMDAwfQ.fake_signature',
  'rt_fake_refresh_token_for_seed_data_only_abc123def456',
  NOW() + INTERVAL '30 days', NOW(), NOW());

-- ============================================================
-- 3. SETTINGS (mi, F, rated, $0.12/kWh, gas $3.96/gallon)
-- ============================================================
INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh, api_suspended, theme, mode, custom_primary, custom_accent, gas_price_per_unit, gas_unit, gas_efficiency_mpg)
VALUES (1, 'mi', 'F', 'rated', 'en', 0.12, false, 'neon-cyan', 'dark', '#00b4d8', '#e63946', 3.96, 'gallon', 25);

-- ============================================================
-- 4. TESLA PUBLIC KEY (single row)
-- ============================================================
INSERT INTO tesla_public_key (id, public_key_pem, fingerprint, created_at)
VALUES (1,
  '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfake0seed0key0data0for0test\npurposes0only0not0a0real0key0abc123456789\n-----END PUBLIC KEY-----',
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  '2020-01-01'::timestamptz);

-- ============================================================
-- 5. ADDRESSES (~10 realistic SF-area locations)
-- ============================================================
INSERT INTO addresses (id, display_name, latitude, longitude, name, house_number, road, city, county, state, country, postcode, created_at) VALUES
  (1, 'Home',                  37.7749, -122.4194, 'Home',             '123',  'Market St',        'San Francisco', 'San Francisco', 'CA', 'US', '94105', '2020-01-01'),
  (2, 'Work',                  37.7851, -122.4094, 'Office',           '456',  'Montgomery St',    'San Francisco', 'San Francisco', 'CA', 'US', '94104', '2020-01-01'),
  (3, 'Tesla Supercharger',    37.7577, -122.3887, 'Supercharger',     '888',  'Brannan St',       'San Francisco', 'San Francisco', 'CA', 'US', '94107', '2020-01-01'),
  (4, 'Westfield Mall',        37.7841, -122.4070, 'Westfield Centre', '865',  'Market St',        'San Francisco', 'San Francisco', 'CA', 'US', '94103', '2020-01-01'),
  (5, 'Gym - 24 Hour Fitness', 37.7694, -122.4293, 'Gym',              '100',  'Masonic Ave',      'San Francisco', 'San Francisco', 'CA', 'US', '94117', '2020-01-01'),
  (6, 'Grocery - Whole Foods', 37.7636, -122.4218, 'Whole Foods',      '399',  '4th St',           'San Francisco', 'San Francisco', 'CA', 'US', '94107', '2020-01-01'),
  (7, 'Golden Gate Park',      37.7694, -122.4862, 'Park',             NULL,   'John F Kennedy Dr','San Francisco', 'San Francisco', 'CA', 'US', '94118', '2020-01-01'),
  (8, 'Napa Valley',           38.2975, -122.2869, 'Napa Valley',      NULL,   'Silverado Trail',  'Napa',          'Napa',          'CA', 'US', '94558', '2020-01-01'),
  (9, 'Half Moon Bay',         37.4636, -122.4286, 'Half Moon Bay',    NULL,   'Cabrillo Hwy',     'Half Moon Bay', 'San Mateo',     'CA', 'US', '94019', '2020-01-01'),
  (10,'Palo Alto Supercharger', 37.4419, -122.1430, 'Supercharger',    '100',  'El Camino Real',   'Palo Alto',     'Santa Clara',   'CA', 'US', '94301', '2020-01-01');
SELECT setval('addresses_id_seq', 10);

-- ============================================================
-- 6. GEOFENCES with electricity rates
-- ============================================================
INSERT INTO geofences (id, name, latitude, longitude, radius, cost_per_kwh, created_at, updated_at) VALUES
  (1, 'Home',                37.7749, -122.4194, 100, 0.12, '2020-01-01', '2020-01-01'),
  (2, 'Work',                37.7851, -122.4094, 150, 0.15, '2020-01-01', '2020-01-01'),
  (3, 'SF Supercharger',     37.7577, -122.3887, 50,  0.31, '2020-01-01', '2020-01-01'),
  (4, 'PA Supercharger',     37.4419, -122.1430, 50,  0.31, '2020-01-01', '2020-01-01');
SELECT setval('geofences_id_seq', 4);

INSERT INTO geofence_electricity_rates (geofence_id, cost_per_kwh, effective_from, effective_to) VALUES
  (1, 0.10, '2020-01-01', '2022-06-30'),
  (1, 0.12, '2022-07-01', NULL),
  (2, 0.15, '2020-01-01', NULL),
  (3, 0.28, '2020-01-01', '2023-12-31'),
  (3, 0.31, '2024-01-01', NULL),
  (4, 0.31, '2020-01-01', NULL);

-- ============================================================
-- 7. CREATE POSITION PARTITIONS (monthly from 2020-01 to 2026-03)
-- ============================================================
DO $$
DECLARE
  m DATE := '2020-01-01';
BEGIN
  WHILE m <= '2026-03-01' LOOP
    PERFORM create_monthly_partition('positions', m);
    m := m + INTERVAL '1 month';
  END LOOP;
END $$;

-- ============================================================
-- 8. POSITIONS — 1 per hour, 2020-01-01 to 2026-03-31
-- ~54,000+ rows generated via generate_series
-- Realistic: lat/lng jitter, speed based on hour, seasonal temp,
-- battery cycling (drain during day, charge at night)
-- ============================================================
INSERT INTO positions (vehicle_id, latitude, longitude, speed, power, heading, elevation, odometer, ideal_range, rated_range, battery_level, inside_temp, outside_temp, fan_status, is_climate_on, created_at)
SELECT
  1 AS vehicle_id,
  -- Lat: home area with jitter; driving hours get bigger offsets
  37.7749 + CASE
    WHEN EXTRACT(DOW FROM ts) IN (0,6) AND EXTRACT(HOUR FROM ts) BETWEEN 10 AND 16 THEN (random() - 0.5) * 0.08
    WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 OR EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18 THEN (random() - 0.5) * 0.03
    ELSE (random() - 0.5) * 0.005
  END AS latitude,
  -122.4194 + CASE
    WHEN EXTRACT(DOW FROM ts) IN (0,6) AND EXTRACT(HOUR FROM ts) BETWEEN 10 AND 16 THEN (random() - 0.5) * 0.12
    WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 OR EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18 THEN (random() - 0.5) * 0.04
    ELSE (random() - 0.5) * 0.005
  END AS longitude,
  -- Speed: 0 parked/sleeping, 30-75 driving
  CASE
    WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 OR EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18 THEN 30 + random() * 45
    WHEN EXTRACT(DOW FROM ts) IN (0,6) AND EXTRACT(HOUR FROM ts) BETWEEN 10 AND 16 THEN 25 + random() * 50
    ELSE 0
  END AS speed,
  -- Power: correlates with speed
  CASE
    WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 OR EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18 THEN 10 + random() * 40
    WHEN EXTRACT(DOW FROM ts) IN (0,6) AND EXTRACT(HOUR FROM ts) BETWEEN 10 AND 16 THEN 8 + random() * 35
    WHEN EXTRACT(HOUR FROM ts) BETWEEN 22 AND 23 OR EXTRACT(HOUR FROM ts) BETWEEN 0 AND 5 THEN -(3 + random() * 5)  -- charging negative
    ELSE 0.5
  END AS power,
  (random() * 360)::int AS heading,
  15 + random() * 30 AS elevation,
  -- Odometer: starts at 1000 mi, adds ~40mi/day = ~1.67/hr
  1000.0 + (EXTRACT(EPOCH FROM (ts - '2020-01-01'::timestamptz)) / 3600.0) * 1.67 AS odometer,
  -- Ideal/Rated range track battery
  (20 + 60 * (0.5 + 0.5 * sin(EXTRACT(HOUR FROM ts) * 3.14159 / 12.0 - 1.5))) * 5.0 AS ideal_range,
  (20 + 60 * (0.5 + 0.5 * sin(EXTRACT(HOUR FROM ts) * 3.14159 / 12.0 - 1.5))) * 4.8 AS rated_range,
  -- Battery: cycles daily — high in morning (post-charge), low in evening
  GREATEST(20, LEAST(90, (55 + 35 * sin(EXTRACT(HOUR FROM ts) * 3.14159 / 12.0 - 1.5))::int)) AS battery_level,
  -- Inside temp: 20-24°C
  20 + random() * 4 AS inside_temp,
  -- Outside temp: seasonal variation (Jan=10, Jul=25, sinusoidal)
  10 + 7.5 * sin((EXTRACT(DOY FROM ts) - 80) * 2 * 3.14159 / 365.0) + (random() - 0.5) * 4 AS outside_temp,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 7 AND 20 THEN (1 + random() * 4)::int ELSE 0 END AS fan_status,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 7 AND 20 THEN true ELSE false END AS is_climate_on,
  ts AS created_at
FROM generate_series('2020-01-01'::timestamptz, '2026-03-31 23:00'::timestamptz, '1 hour') AS ts;

-- ============================================================
-- 9. DRIVES — ~2/weekday (commute), ~1/weekend
-- ============================================================
INSERT INTO drives (vehicle_id, start_date, end_date, start_address_id, end_address_id, distance, duration_min,
                    start_range_km, end_range_km, speed_max, power_max, power_min,
                    start_battery_level, end_battery_level, inside_temp_avg, outside_temp_avg)
-- Morning commute (weekdays)
SELECT 1, d + TIME '08:00' + (random() * INTERVAL '30 min'),
       d + TIME '08:30' + (random() * INTERVAL '30 min'),
       1, 2,  -- Home → Work
       8 + random() * 7,   -- 8-15 km
       20 + random() * 20, -- 20-40 min
       350 - random() * 50, 310 - random() * 50,
       80 + random() * 55,  -- speed_max 80-135 km/h
       120 + random() * 80, -- power_max
       -(40 + random() * 30), -- power_min (regen)
       GREATEST(20, LEAST(90, (75 + random() * 15)::int)),
       GREATEST(20, LEAST(90, (65 + random() * 10)::int)),
       21 + random() * 3,
       10 + 7.5 * sin((EXTRACT(DOY FROM d) - 80) * 2 * 3.14159 / 365.0) + (random() - 0.5) * 3
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '1 day') d
WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
UNION ALL
-- Evening commute (weekdays)
SELECT 1, d + TIME '17:00' + (random() * INTERVAL '45 min'),
       d + TIME '17:40' + (random() * INTERVAL '40 min'),
       2, 1,  -- Work → Home
       8 + random() * 7,
       25 + random() * 25,
       280 - random() * 40, 250 - random() * 40,
       75 + random() * 50,
       110 + random() * 70,
       -(35 + random() * 25),
       GREATEST(20, LEAST(90, (55 + random() * 15)::int)),
       GREATEST(20, LEAST(90, (45 + random() * 10)::int)),
       21 + random() * 3,
       10 + 7.5 * sin((EXTRACT(DOY FROM d) - 80) * 2 * 3.14159 / 365.0) + (random() - 0.5) * 3
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '1 day') d
WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
UNION ALL
-- Weekend trip (longer)
SELECT 1, d + TIME '10:00' + (random() * INTERVAL '2 hours'),
       d + TIME '11:30' + (random() * INTERVAL '2 hours'),
       1, (ARRAY[4,5,6,7,8,9])[1 + (random()*5)::int],  -- Home → various
       20 + random() * 60,  -- 20-80 km
       30 + random() * 60,  -- 30-90 min
       380 - random() * 50, 300 - random() * 80,
       90 + random() * 60,
       140 + random() * 100,
       -(50 + random() * 40),
       GREATEST(20, LEAST(90, (80 + random() * 10)::int)),
       GREATEST(20, LEAST(90, (55 + random() * 15)::int)),
       21 + random() * 3,
       10 + 7.5 * sin((EXTRACT(DOY FROM d) - 80) * 2 * 3.14159 / 365.0) + (random() - 0.5) * 3
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '1 day') d
WHERE EXTRACT(DOW FROM d) IN (0, 6);

-- ============================================================
-- 10. CHARGING SESSIONS — nightly home + occasional supercharger
-- ============================================================
-- Nightly home charging (every day)
INSERT INTO charging_sessions (vehicle_id, start_date, end_date, address_id,
  charge_energy_added, charge_energy_used, start_battery_level, end_battery_level,
  start_range_km, end_range_km, charger_phases, charger_voltage, charger_actual_current,
  charger_power, fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min)
SELECT 1,
  d + TIME '22:00' + (random() * INTERVAL '30 min'),
  d + TIME '22:00' + INTERVAL '4 hours' + (random() * INTERVAL '2 hours'),
  1,  -- Home
  25 + random() * 20,   -- 25-45 kWh added
  27 + random() * 22,   -- slightly more used than added
  GREATEST(20, LEAST(60, (35 + random() * 20)::int)),  -- start 35-55%
  GREATEST(75, LEAST(90, (80 + random() * 10)::int)),  -- end 80-90%
  200 + random() * 100, -- start range
  380 + random() * 50,  -- end range
  1, 240, 32,           -- single phase, 240V, 32A
  7.68,                 -- 7.68 kW wall connector
  NULL, NULL, 'SAE',
  (25 + random() * 20) * 0.12,  -- cost at $0.12/kWh
  240 + random() * 120  -- 4-6 hours
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '1 day') d;

-- Supercharger sessions (~2x per month = every 15 days)
INSERT INTO charging_sessions (vehicle_id, start_date, end_date, address_id,
  charge_energy_added, charge_energy_used, start_battery_level, end_battery_level,
  start_range_km, end_range_km, charger_phases, charger_voltage, charger_actual_current,
  charger_power, fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min)
SELECT 1,
  d + TIME '14:00' + (random() * INTERVAL '2 hours'),
  d + TIME '14:30' + (random() * INTERVAL '30 min'),
  CASE WHEN random() > 0.5 THEN 3 ELSE 10 END,  -- SF or PA supercharger
  40 + random() * 25,    -- 40-65 kWh
  42 + random() * 27,
  GREATEST(10, LEAST(35, (15 + random() * 15)::int)),
  GREATEST(75, LEAST(90, (80 + random() * 10)::int)),
  80 + random() * 100,
  370 + random() * 60,
  3, 400, (150 + random() * 100)::int,
  120 + random() * 80,   -- 120-200 kW
  'Tesla', 'Tesla', 'IEC',
  (40 + random() * 25) * 0.31,  -- supercharger rate
  25 + random() * 15     -- 25-40 min
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '15 days') d;

-- ============================================================
-- 11. CHARGING TELEMETRY — last 30 days, ~1 record per 10 min during charging
-- ============================================================
INSERT INTO charging_telemetry (vehicle_id, battery_level, soc, charge_state, detailed_charge_state,
  charge_limit_soc, charge_amps, charge_current_request, charge_current_request_max,
  charge_enable_request, charger_voltage, charger_phases, charge_rate_mph,
  dc_charging_power, dc_charging_energy_in, ac_charging_power, ac_charging_energy_in,
  energy_remaining, est_battery_range, ideal_battery_range, rated_range,
  pack_voltage, pack_current, charge_port_door_open, charge_port_latch,
  charge_port_cold_weather_mode, charging_cable_type, fast_charger_present, fast_charger_type,
  time_to_full_charge, estimated_hours_to_charge, scheduled_charging_mode, scheduled_charging_pending,
  preconditioning_enabled, brick_voltage_max, brick_voltage_min, num_brick_voltage_max,
  num_brick_voltage_min, module_temp_max, module_temp_min, num_module_temp_max, num_module_temp_min,
  battery_heater_on, not_enough_power_to_heat, bms_state, bms_fullcharge_complete,
  dcdc_enable, isolation_resistance, lifetime_energy_used, supercharger_session_trip_planner,
  powershare_status, powershare_type, powershare_stop_reason, powershare_hours_left, powershare_power_kw,
  created_at)
SELECT 1,
  -- battery_level ramps up over the charging session
  LEAST(90, (40 + (rn * 2))::int),
  LEAST(0.90, 0.40 + rn * 0.02),
  'Charging', 'AC_Charging',
  90, 32, 32, 32,
  true, 240, 1, 28 + random() * 4,
  0, 0, 7.5 + random() * 0.5, rn * 1.25,
  75.0 - rn * 1.0, 200 + rn * 8, 210 + rn * 8, 205 + rn * 8,
  395 + random() * 10, 31 + random() * 2, true, 'Engaged',
  false, 'SAE', false, NULL,
  GREATEST(0.1, (5.0 - rn * 0.2)), GREATEST(0.1, (5.0 - rn * 0.2)),
  'Off', false,
  false, 4.18 + random() * 0.02, 4.15 + random() * 0.02, 48, 48,
  25 + random() * 5, 23 + random() * 5, 4, 4,
  false, false, 'Charging', false,
  true, 1500 + random() * 200, 45000 + EXTRACT(EPOCH FROM d - '2026-03-01'::date) / 86400.0 * 35,
  false, 'Inactive', 'None', 'None', 0, 0,
  d + TIME '22:00' + (rn * INTERVAL '10 min')
FROM generate_series('2026-03-01'::date, '2026-03-31'::date, '1 day') d
CROSS JOIN generate_series(0, 29) rn  -- 30 records per session (~5 hours)
WHERE d + TIME '22:00' + (rn * INTERVAL '10 min') <= d + INTERVAL '1 day' + TIME '03:00';

-- ============================================================
-- 12. VEHICLE STATES — cycle through states realistically
-- ============================================================
INSERT INTO vehicle_states (vehicle_id, state, start_date, end_date, duration_min, created_at)
-- Each day: asleep → online → driving → online → driving → charging → asleep
SELECT 1, s.state,
  d + s.start_offset,
  d + s.end_offset,
  EXTRACT(EPOCH FROM (s.end_offset - s.start_offset)) / 60.0,
  d + s.start_offset
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '1 day') d
CROSS JOIN (VALUES
  ('asleep',   TIME '00:00', TIME '07:30'),
  ('online',   TIME '07:30', TIME '08:00'),
  ('driving',  TIME '08:00', TIME '08:45'),
  ('online',   TIME '08:45', TIME '17:00'),
  ('driving',  TIME '17:00', TIME '17:45'),
  ('online',   TIME '17:45', TIME '22:00'),
  ('charging', TIME '22:00', TIME '23:59')
) AS s(state, start_offset, end_offset);

-- ============================================================
-- 13. DAILY MILEAGE — every day, 20-80 km
-- ============================================================
INSERT INTO daily_mileage (vehicle_id, date, distance_km, odometer_start, odometer_end, drive_count, energy_used_kwh)
SELECT 1, d::date,
  CASE WHEN EXTRACT(DOW FROM d) IN (0,6) THEN 40 + random() * 40 ELSE 20 + random() * 30 END,
  1600.0 + (d::date - '2020-01-01'::date) * 64.0,  -- ~40mi/day in km
  1600.0 + (d::date - '2020-01-01'::date) * 64.0 + CASE WHEN EXTRACT(DOW FROM d) IN (0,6) THEN 40 + random()*40 ELSE 20 + random()*30 END,
  CASE WHEN EXTRACT(DOW FROM d) IN (0,6) THEN 1 ELSE 2 END,
  CASE WHEN EXTRACT(DOW FROM d) IN (0,6) THEN 8 + random() * 8 ELSE 4 + random() * 6 END
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '1 day') d;

-- ============================================================
-- 14. MOTOR SNAPSHOTS — last 90 days, during driving hours
-- ============================================================
INSERT INTO motor_snapshots (vehicle_id, di_state, di_torque, di_axle_speed, di_stator_temp, pedal_position,
  brake_pedal, lateral_accel, longitudinal_accel, vehicle_speed, gear,
  di_torque_actual_f, di_torque_actual_r, di_torque_actual_rel, di_torque_actual_rer,
  di_axle_speed_f, di_axle_speed_rel, di_axle_speed_rer,
  di_state_f, di_state_rel, di_state_rer,
  di_stator_temp_f, di_stator_temp_rel, di_stator_temp_rer,
  di_heatsink_t_f, di_heatsink_t_r, di_heatsink_t_rel, di_heatsink_t_rer,
  di_inverter_t_f, di_inverter_t_r, di_inverter_t_rel, di_inverter_t_rer,
  di_motor_current_f, di_motor_current_r, di_motor_current_rel, di_motor_current_rer,
  di_v_bat_f, di_v_bat_r, di_v_bat_rel, di_v_bat_rer,
  di_slave_torque_cmd, hvil, brake_pedal_pos, cruise_set_speed, drive_rail, created_at)
SELECT 1, 'drive',
  50 + random() * 250,       -- torque 50-300 Nm
  500 + random() * 5000,     -- axle speed
  30 + random() * 50,        -- stator temp 30-80°C
  10 + random() * 80,        -- pedal 10-90%
  false, (random()-0.5)*2, random()*3,
  30 + random() * 75,        -- speed 30-105 km/h
  'D',
  -- dual motor torques
  20+random()*100, 30+random()*150, 0, 0,
  500+random()*5000, 0, 0,
  'drive', 'inactive', 'inactive',
  30+random()*50, 25+random()*10, 25+random()*10,
  25+random()*25, 25+random()*25, 22+random()*10, 22+random()*10,
  28+random()*17, 28+random()*17, 26+random()*8, 26+random()*8,
  10+random()*190, 10+random()*190, 0, 0,
  390+random()*15, 390+random()*15, 0, 0,
  30+random()*100, 'OK', 0, 105, true,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '15 min') ts
WHERE EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9
   OR EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18
   OR (EXTRACT(DOW FROM ts) IN (0,6) AND EXTRACT(HOUR FROM ts) BETWEEN 10 AND 16);

-- ============================================================
-- 15. CLIMATE SNAPSHOTS — last 90 days
-- ============================================================
INSERT INTO climate_snapshots (vehicle_id, inside_temp, outside_temp, hvac_power, hvac_fan_speed,
  hvac_left_temp_request, hvac_right_temp_request, cabin_overheat_mode, defrost_mode,
  battery_heater_on, hvac_ac_enabled, hvac_auto_mode, hvac_fan_status, hvac_steering_wheel_heat_auto,
  hvac_steering_wheel_heat_level, climate_keeper_mode, cabin_overheat_protection_temp_limit,
  defrost_for_preconditioning, seat_heater_left, seat_heater_right, seat_heater_rear_left,
  seat_heater_rear_center, seat_heater_rear_right, seat_vent_enabled,
  climate_seat_cooling_front_left, climate_seat_cooling_front_right,
  auto_seat_climate_left, auto_seat_climate_right, rear_defrost_enabled,
  rear_display_hvac_enabled, wiper_heat_enabled, created_at)
SELECT 1,
  20 + random() * 4,
  10 + 7.5 * sin((EXTRACT(DOY FROM ts) - 80) * 2 * 3.14159 / 365.0) + (random()-0.5)*4,
  1.5 + random() * 3.5,
  (1 + random() * 4)::int,
  21.0, 21.0, 'On', false,
  -- winter: battery heater on
  CASE WHEN EXTRACT(MONTH FROM ts) IN (12,1,2) THEN true ELSE false END,
  true, true, (1 + random()*4)::int, true,
  CASE WHEN EXTRACT(MONTH FROM ts) IN (12,1,2) THEN 2 ELSE 0 END,
  'off', 40,
  false,
  -- seat heaters in winter months
  CASE WHEN EXTRACT(MONTH FROM ts) IN (12,1,2,3) THEN (1+random()*2)::int ELSE 0 END,
  CASE WHEN EXTRACT(MONTH FROM ts) IN (12,1,2,3) THEN (1+random()*2)::int ELSE 0 END,
  0, 0, 0,
  CASE WHEN EXTRACT(MONTH FROM ts) IN (6,7,8,9) THEN true ELSE false END,
  CASE WHEN EXTRACT(MONTH FROM ts) IN (6,7,8,9) THEN (1+random()*2)::int ELSE 0 END,
  CASE WHEN EXTRACT(MONTH FROM ts) IN (6,7,8,9) THEN (1+random()*2)::int ELSE 0 END,
  true, true, false, false,
  CASE WHEN EXTRACT(MONTH FROM ts) IN (12,1,2) THEN true ELSE false END,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '30 min') ts
WHERE EXTRACT(HOUR FROM ts) BETWEEN 7 AND 22;

-- ============================================================
-- 16. SECURITY EVENTS — last 90 days
-- ============================================================
INSERT INTO security_events (vehicle_id, locked, sentry_mode, door_state, fd_window, fp_window, rd_window, rp_window,
  homelink_nearby, guest_mode, homelink_device_count, guest_mode_mobile_access_state,
  driver_seat_occupied, center_display, speed_limit_mode, valet_mode_enabled, service_mode,
  current_limit_mph, paired_phone_key_count, lights_hazards_active, lights_high_beams,
  lights_turn_signal, tonneau_position, tonneau_open_percent, tonneau_tent_mode,
  driver_seat_belt, passenger_seat_belt, created_at)
SELECT 1,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18 THEN true ELSE EXTRACT(HOUR FROM ts) > 22 OR EXTRACT(HOUR FROM ts) < 7 END,
  -- Sentry on when parked away from home (work hours)
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 9 AND 17 AND EXTRACT(DOW FROM ts) BETWEEN 1 AND 5 THEN true ELSE false END,
  'Closed', 'Closed', 'Closed', 'Closed', 'Closed',
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 19 AND 23 THEN true ELSE false END,  -- homelink near home
  false, 1, 'off',
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18 THEN false ELSE false END,
  'On', 'off', false, false,
  85, 2, false, false,
  'off', NULL, NULL, false,
  false, false,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '1 hour') ts;

-- ============================================================
-- 17. TIRE PRESSURE SNAPSHOTS — last 90 days, every 4 hours
-- ============================================================
INSERT INTO tire_pressure_snapshots (vehicle_id, front_left, front_right, rear_left, rear_right, created_at)
SELECT 1,
  2.9 + random() * 0.3,
  2.9 + random() * 0.3,
  2.85 + random() * 0.35,
  2.85 + random() * 0.35,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '4 hours') ts;

-- ============================================================
-- 18. BATTERY HEALTH SNAPSHOTS — monthly, 100% → ~92% by 2026
-- ============================================================
INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh, degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
SELECT 1,
  GREATEST(91, 100.0 - (EXTRACT(EPOCH FROM (m - '2020-01-01'::timestamptz)) / (365.25*86400)) * 1.3),
  75.0 * GREATEST(0.91, 1.0 - (EXTRACT(EPOCH FROM (m - '2020-01-01'::timestamptz)) / (365.25*86400)) * 0.013),
  LEAST(9, (EXTRACT(EPOCH FROM (m - '2020-01-01'::timestamptz)) / (365.25*86400)) * 1.3),
  480 * GREATEST(0.91, 1.0 - (EXTRACT(EPOCH FROM (m - '2020-01-01'::timestamptz)) / (365.25*86400)) * 0.013),
  (EXTRACT(EPOCH FROM (m - '2020-01-01'::timestamptz)) / (365.25*86400) * 200)::int,
  25 + random() * 10,
  m
FROM generate_series('2020-01-01'::timestamptz, '2026-03-01'::timestamptz, '1 month') m;

-- ============================================================
-- 19. ALERTS — mix of types over time
-- ============================================================
INSERT INTO alerts (vehicle_id, type, severity, title, message, is_read, created_at)
-- Battery low alerts (~monthly)
SELECT 1, 'battery_low', 'warning', 'Battery Below 20%',
  'Battery level dropped to ' || (15 + (random()*5)::int) || '%. Consider charging soon.',
  true, d + (random() * INTERVAL '12 hours')
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '30 days') d
UNION ALL
-- Charging complete (~daily)
SELECT 1, 'charging_complete', 'info', 'Charging Complete',
  'Vehicle charged to ' || (85 + (random()*5)::int) || '%. Range: ' || (380 + (random()*40)::int) || ' km.',
  true, d + TIME '04:00' + (random() * INTERVAL '2 hours')
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '7 days') d
UNION ALL
-- Sentry events (~weekly)
SELECT 1, 'sentry', 'warning', 'Sentry Mode Event',
  'Motion detected near vehicle at ' || (ARRAY['Work', 'Mall', 'Gym', 'Grocery'])[1+(random()*3)::int] || '.',
  CASE WHEN d > '2026-03-01'::date THEN false ELSE true END,
  d + TIME '14:00' + (random() * INTERVAL '4 hours')
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '7 days') d
UNION ALL
-- Speed alerts (~quarterly)
SELECT 1, 'speed_limit', 'critical', 'Speed Limit Exceeded',
  'Vehicle exceeded 120 km/h. Max speed: ' || (125 + (random()*20)::int) || ' km/h.',
  true, d + TIME '10:00' + (random() * INTERVAL '6 hours')
FROM generate_series('2020-03-01'::date, '2026-03-31'::date, '90 days') d;

-- ============================================================
-- 20. ALERT RULES
-- ============================================================
INSERT INTO alert_rules (name, type, enabled, threshold, vehicle_id, created_at, updated_at) VALUES
  ('Low Battery Alert',   'battery_low',  true,  20,  1, '2020-01-01', '2020-01-01'),
  ('Battery Full Alert',  'battery_full', true,  95,  1, '2020-01-01', '2020-01-01'),
  ('Sentry Mode Event',   'sentry',       true,  0,   1, '2020-01-01', '2020-01-01'),
  ('Speed Alert',         'speed',        true,  120, 1, '2020-01-01', '2020-01-01'),
  ('Geofence Alert',      'geofence',     true,  0,   1, '2020-01-01', '2020-01-01'),
  ('Software Update',     'software',     true,  0,   1, '2020-01-01', '2020-01-01');

-- ============================================================
-- 21. NOTIFICATION CHANNELS
-- ============================================================
INSERT INTO notification_channels (id, name, type, config, enabled, created_at, updated_at) VALUES
  (1, 'Primary Webhook', 'webhook', '{"url":"https://hooks.example.com/teslasync","secret":"whsec_seed123"}', true, '2020-01-01', NOW());
SELECT setval('notification_channels_id_seq', 1);

-- ============================================================
-- 22. NOTIFICATION PREFERENCES
-- ============================================================
INSERT INTO notification_preferences (channel_id, event_type, enabled, created_at) VALUES
  (1, 'battery_low', true, '2020-01-01'),
  (1, 'charging_complete', true, '2020-01-01'),
  (1, 'sentry_event', true, '2020-01-01'),
  (1, 'speed_limit', true, '2020-01-01'),
  (1, 'software_update', true, '2020-01-01');

-- ============================================================
-- 23. NOTIFICATION SCHEDULES
-- ============================================================
INSERT INTO notification_schedules (channel_id, title, message, cron_expr, scheduled_at, last_run_at, next_run_at, enabled, created_at, updated_at) VALUES
  (1, 'Daily Battery Report', 'Battery and charging summary for the day', '0 8 * * *', NULL, NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day', true, '2020-01-01', NOW());

-- ============================================================
-- 24. NOTIFICATION LOGS — some recent sent notifications
-- ============================================================
INSERT INTO notification_logs (channel_id, alert_id, title, message, status, error, scheduled_at, latency_ms, created_at, sent_at)
SELECT 1, a.id, a.title, a.message, 'sent', NULL, NULL,
  50 + (random() * 200)::int,
  a.created_at, a.created_at + INTERVAL '1 second'
FROM alerts a
WHERE a.created_at > NOW() - INTERVAL '90 days'
LIMIT 50;

-- ============================================================
-- 25. NOTIFICATION METRICS — last 90 days
-- ============================================================
INSERT INTO notification_metrics (channel_id, date, total_sent, total_failed, avg_latency_ms)
SELECT 1, d, (1 + random() * 5)::int, CASE WHEN random() > 0.9 THEN 1 ELSE 0 END, (80 + random() * 150)::int
FROM generate_series((CURRENT_DATE - 90), CURRENT_DATE, '1 day') d;

-- ============================================================
-- 26. VISITED LOCATIONS — top locations with visit counts
-- ============================================================
INSERT INTO visited_locations (vehicle_id, address_id, visit_count, total_duration_min, last_visited, created_at) VALUES
  (1, 1, 2283, 2283 * 480, NOW() - INTERVAL '1 hour', '2020-01-01'),
  (1, 2, 1630, 1630 * 510, NOW() - INTERVAL '3 hours', '2020-01-01'),
  (1, 3, 152,  152 * 35,   NOW() - INTERVAL '10 days', '2020-01-01'),
  (1, 5, 420,  420 * 90,   NOW() - INTERVAL '2 days',  '2020-01-01'),
  (1, 6, 310,  310 * 45,   NOW() - INTERVAL '4 days',  '2020-01-01'),
  (1, 4, 180,  180 * 120,  NOW() - INTERVAL '7 days',  '2020-01-01'),
  (1, 7, 95,   95 * 180,   NOW() - INTERVAL '14 days', '2020-01-01'),
  (1, 8, 25,   25 * 360,   NOW() - INTERVAL '30 days', '2020-01-01'),
  (1, 9, 35,   35 * 240,   NOW() - INTERVAL '21 days', '2020-01-01'),
  (1, 10, 48,  48 * 30,    NOW() - INTERVAL '15 days', '2020-01-01');

-- ============================================================
-- 27. TRIPS — monthly groupings
-- ============================================================
INSERT INTO trips (vehicle_id, name, start_date, end_date, total_distance_km, total_energy_kwh, total_cost, drive_count, charge_count, created_at)
SELECT 1,
  to_char(m, 'Mon YYYY') || ' Summary',
  m,
  m + INTERVAL '1 month' - INTERVAL '1 second',
  1200 + random() * 800,     -- 1200-2000 km/month
  200 + random() * 150,      -- 200-350 kWh/month
  (200 + random() * 150) * 0.12,
  CASE WHEN EXTRACT(MONTH FROM m) IN (12,1) THEN 45 + (random()*10)::int ELSE 55 + (random()*10)::int END,
  28 + (random() * 5)::int,
  m
FROM generate_series('2020-01-01'::timestamptz, '2026-03-01'::timestamptz, '1 month') m;

-- ============================================================
-- 28. GAS PRICE HISTORY — quarterly from 2020 ($2.50 → $3.96)
-- ============================================================
INSERT INTO gas_price_history (price_per_unit, unit, efficiency_mpg, effective_from, effective_to, created_at)
VALUES
  (2.50, 'gallon', 25, '2020-01-01', '2020-03-31', '2020-01-01'),
  (2.10, 'gallon', 25, '2020-04-01', '2020-06-30', '2020-04-01'),
  (2.30, 'gallon', 25, '2020-07-01', '2020-09-30', '2020-07-01'),
  (2.25, 'gallon', 25, '2020-10-01', '2020-12-31', '2020-10-01'),
  (2.55, 'gallon', 25, '2021-01-01', '2021-03-31', '2021-01-01'),
  (2.90, 'gallon', 25, '2021-04-01', '2021-06-30', '2021-04-01'),
  (3.10, 'gallon', 25, '2021-07-01', '2021-09-30', '2021-07-01'),
  (3.25, 'gallon', 25, '2021-10-01', '2021-12-31', '2021-10-01'),
  (3.50, 'gallon', 25, '2022-01-01', '2022-03-31', '2022-01-01'),
  (4.50, 'gallon', 25, '2022-04-01', '2022-06-30', '2022-04-01'),
  (4.80, 'gallon', 25, '2022-07-01', '2022-09-30', '2022-07-01'),
  (3.80, 'gallon', 25, '2022-10-01', '2022-12-31', '2022-10-01'),
  (3.60, 'gallon', 25, '2023-01-01', '2023-03-31', '2023-01-01'),
  (3.70, 'gallon', 25, '2023-04-01', '2023-06-30', '2023-04-01'),
  (3.90, 'gallon', 25, '2023-07-01', '2023-09-30', '2023-07-01'),
  (3.50, 'gallon', 25, '2023-10-01', '2023-12-31', '2023-10-01'),
  (3.30, 'gallon', 25, '2024-01-01', '2024-03-31', '2024-01-01'),
  (3.55, 'gallon', 25, '2024-04-01', '2024-06-30', '2024-04-01'),
  (3.70, 'gallon', 25, '2024-07-01', '2024-09-30', '2024-07-01'),
  (3.45, 'gallon', 25, '2024-10-01', '2024-12-31', '2024-10-01'),
  (3.40, 'gallon', 25, '2025-01-01', '2025-03-31', '2025-01-01'),
  (3.60, 'gallon', 25, '2025-04-01', '2025-06-30', '2025-04-01'),
  (3.80, 'gallon', 25, '2025-07-01', '2025-09-30', '2025-07-01'),
  (3.75, 'gallon', 25, '2025-10-01', '2025-12-31', '2025-10-01'),
  (3.96, 'gallon', 25, '2026-01-01', NULL,          '2026-01-01');

-- ============================================================
-- 29. GAS PRICE POLL STATE
-- ============================================================
INSERT INTO gas_price_poll_state (id, enabled, poll_interval, last_poll_time, last_price)
VALUES (1, true, '7d', NOW() - INTERVAL '2 days', 3.96);

-- ============================================================
-- 30. SOFTWARE UPDATES — quarterly version history
-- ============================================================
INSERT INTO software_updates (vehicle_id, version, status, scheduled_at, installed_at, created_at) VALUES
  (1, '2020.4.1',   'installed', '2020-02-01', '2020-02-01 03:00', '2020-01-25'),
  (1, '2020.12.5',  'installed', '2020-04-15', '2020-04-15 02:30', '2020-04-10'),
  (1, '2020.24.6',  'installed', '2020-07-01', '2020-07-01 03:15', '2020-06-25'),
  (1, '2020.36.11', 'installed', '2020-10-01', '2020-10-01 02:45', '2020-09-25'),
  (1, '2020.48.26', 'installed', '2021-01-05', '2021-01-05 03:00', '2020-12-28'),
  (1, '2021.4.18',  'installed', '2021-04-01', '2021-04-01 02:30', '2021-03-25'),
  (1, '2021.12.25', 'installed', '2021-07-01', '2021-07-01 03:10', '2021-06-25'),
  (1, '2021.36.5',  'installed', '2021-10-01', '2021-10-01 02:50', '2021-09-25'),
  (1, '2021.44.25', 'installed', '2022-01-10', '2022-01-10 03:00', '2022-01-05'),
  (1, '2022.8.3',   'installed', '2022-04-01', '2022-04-01 02:30', '2022-03-25'),
  (1, '2022.20.7',  'installed', '2022-07-01', '2022-07-01 03:20', '2022-06-25'),
  (1, '2022.36.1',  'installed', '2022-10-01', '2022-10-01 02:40', '2022-09-25'),
  (1, '2022.44.2',  'installed', '2023-01-05', '2023-01-05 03:00', '2022-12-28'),
  (1, '2023.6.9',   'installed', '2023-04-01', '2023-04-01 02:30', '2023-03-25'),
  (1, '2023.20.4',  'installed', '2023-07-01', '2023-07-01 03:10', '2023-06-25'),
  (1, '2023.32.9',  'installed', '2023-10-01', '2023-10-01 02:50', '2023-09-25'),
  (1, '2023.44.30', 'installed', '2024-01-10', '2024-01-10 03:00', '2024-01-05'),
  (1, '2024.2.7',   'installed', '2024-04-01', '2024-04-01 02:30', '2024-03-25'),
  (1, '2024.14.5',  'installed', '2024-07-01', '2024-07-01 03:15', '2024-06-25'),
  (1, '2024.26.8',  'installed', '2024-10-01', '2024-10-01 02:45', '2024-09-25'),
  (1, '2024.38.3',  'installed', '2025-01-05', '2025-01-05 03:00', '2024-12-28'),
  (1, '2025.2.6',   'installed', '2025-04-01', '2025-04-01 02:30', '2025-03-25'),
  (1, '2025.10.1',  'installed', '2025-07-01', '2025-07-01 03:10', '2025-06-25'),
  (1, '2025.20.3',  'installed', '2025-10-01', '2025-10-01 02:50', '2025-09-25'),
  (1, '2026.2.1',   'installed', '2026-01-10', '2026-01-10 03:00', '2026-01-05'),
  (1, '2026.8.4',   'available', NULL, NULL, '2026-03-20');

-- ============================================================
-- 31. API CALL LOGS — recent 30 days
-- ============================================================
INSERT INTO api_call_logs (method, url, status_code, request_body, response_body, duration_ms, error, source, created_at)
SELECT
  (ARRAY['GET','GET','GET','POST','GET'])[1+(random()*4)::int],
  (ARRAY[
    'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/1098765432/vehicle_data',
    'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles',
    'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/1098765432/data_request/charge_state',
    'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/1098765432/command/wake_up',
    'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/1098765432/data_request/drive_state'
  ])[1+(random()*4)::int],
  CASE WHEN random() > 0.95 THEN 429 WHEN random() > 0.98 THEN 500 ELSE 200 END,
  '{}',
  '{"response":{"id":1098765432,"state":"online"}}',
  (50 + random() * 500)::int,
  CASE WHEN random() > 0.95 THEN 'rate_limit_exceeded' ELSE NULL END,
  'tesla_api',
  ts
FROM generate_series(NOW() - INTERVAL '30 days', NOW(), '15 min') ts;

-- ============================================================
-- 32. AUDIT LOGS — recent activity
-- ============================================================
INSERT INTO audit_logs (action, resource, details, ip, created_at)
SELECT
  (ARRAY['login', 'view_dashboard', 'update_settings', 'view_drives', 'view_charging', 'export_data', 'view_alerts'])[1+(random()*6)::int],
  (ARRAY['auth', 'dashboard', 'settings', 'drives', 'charging', 'export', 'alerts'])[1+(random()*6)::int],
  'User performed action from web UI',
  '192.168.1.' || (2 + (random()*253)::int),
  ts
FROM generate_series(NOW() - INTERVAL '30 days', NOW(), '2 hours') ts;

-- ============================================================
-- 33. API KEYS
-- ============================================================
INSERT INTO api_keys (name, key_hash, key_prefix, permissions, last_used_at, created_at, expires_at) VALUES
  ('Grafana Dashboard', 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd', 'tsk_grf_', 'read', NOW() - INTERVAL '1 hour', '2020-06-01', '2027-06-01'),
  ('Home Assistant',    'b2c3d4e5f67890123456789012345678901234567890123456789012345678ef', 'tsk_ha_',  'read', NOW() - INTERVAL '6 hours', '2021-01-15', '2027-01-15');

-- ============================================================
-- 34. COMMAND LOGS — recent commands
-- ============================================================
INSERT INTO command_logs (vehicle_id, command, params, status, error, created_at) VALUES
  (1, 'wake_up',             '',                      'success', '', NOW() - INTERVAL '2 hours'),
  (1, 'honk_horn',           '',                      'success', '', NOW() - INTERVAL '1 day'),
  (1, 'flash_lights',        '',                      'success', '', NOW() - INTERVAL '1 day'),
  (1, 'door_lock',           '',                      'success', '', NOW() - INTERVAL '3 days'),
  (1, 'door_unlock',         '',                      'success', '', NOW() - INTERVAL '3 days'),
  (1, 'climate_on',          '{"temp": 21}',          'success', '', NOW() - INTERVAL '5 days'),
  (1, 'climate_off',         '',                      'success', '', NOW() - INTERVAL '5 days'),
  (1, 'set_charge_limit',    '{"percent": 90}',       'success', '', NOW() - INTERVAL '7 days'),
  (1, 'charge_start',        '',                      'success', '', NOW() - INTERVAL '7 days'),
  (1, 'charge_stop',         '',                      'success', '', NOW() - INTERVAL '7 days'),
  (1, 'set_sentry_mode',     '{"on": true}',          'success', '', NOW() - INTERVAL '10 days'),
  (1, 'actuate_trunk',       '{"which": "rear"}',     'success', '', NOW() - INTERVAL '14 days');

-- ============================================================
-- 35. VAMPIRE DRAIN EVENTS — overnight drain samples
-- ============================================================
INSERT INTO vampire_drain_events (vehicle_id, start_date, end_date, start_battery, end_battery, battery_lost, range_lost_km, duration_hours, drain_rate_pct_per_hour, outside_temp_avg, sentry_mode, created_at)
SELECT 1,
  d + TIME '00:00', d + TIME '07:00',
  (75 + random() * 15)::int,
  (73 + random() * 15)::int,
  (1 + random() * 3)::int,
  (5 + random() * 15),
  7,
  (0.15 + random() * 0.3),
  10 + 7.5 * sin((EXTRACT(DOY FROM d) - 80) * 2 * 3.14159 / 365.0),
  CASE WHEN EXTRACT(DOW FROM d) BETWEEN 1 AND 5 THEN false ELSE random() > 0.5 END,
  d
FROM generate_series('2020-01-01'::date, '2026-03-31'::date, '7 days') d;

-- ============================================================
-- 36. LOCATION SNAPSHOTS — last 90 days
-- ============================================================
INSERT INTO location_snapshots (vehicle_id, destination_name, destination_lat, destination_lon, origin_lat, origin_lon,
  miles_to_arrival, minutes_to_arrival, route_line, route_traffic_delay_min,
  located_at_home, located_at_work, located_at_favorite, gps_state, created_at)
SELECT 1,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 THEN 'Work'
       WHEN EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18 THEN 'Home'
       ELSE NULL END,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 THEN 37.7851 ELSE 37.7749 END,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 THEN -122.4094 ELSE -122.4194 END,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 THEN 37.7749 ELSE 37.7851 END,
  CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 THEN -122.4194 ELSE -122.4094 END,
  CASE WHEN EXTRACT(HOUR FROM ts) IN (8,17) THEN 3 + random() * 5 ELSE 0 END,
  CASE WHEN EXTRACT(HOUR FROM ts) IN (8,17) THEN 15 + random() * 25 ELSE 0 END,
  NULL,
  CASE WHEN EXTRACT(HOUR FROM ts) IN (8,17) THEN random() * 5 ELSE 0 END,
  EXTRACT(HOUR FROM ts) NOT BETWEEN 8 AND 17,
  EXTRACT(HOUR FROM ts) BETWEEN 9 AND 17,
  false, 'Fix3D', ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '1 hour') ts;

-- ============================================================
-- 37. MEDIA SNAPSHOTS — last 90 days, during driving
-- ============================================================
INSERT INTO media_snapshots (vehicle_id, now_playing_title, now_playing_artist, now_playing_album,
  now_playing_station, now_playing_duration, now_playing_elapsed, playback_status, playback_source,
  audio_volume, audio_volume_max, created_at)
SELECT 1,
  (ARRAY['Shape of You','Blinding Lights','Bohemian Rhapsody','Hotel California','Starboy','Levitating','Watermelon Sugar','Bad Guy','Rolling in the Deep','Uptown Funk'])[1+(random()*9)::int],
  (ARRAY['Ed Sheeran','The Weeknd','Queen','Eagles','The Weeknd','Dua Lipa','Harry Styles','Billie Eilish','Adele','Bruno Mars'])[1+(random()*9)::int],
  'Greatest Hits',
  'Spotify',
  180 + (random() * 120)::int,
  (random() * 180)::int,
  'Playing', 'Spotify',
  (4 + random() * 7)::int, 11,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '30 min') ts
WHERE EXTRACT(HOUR FROM ts) BETWEEN 8 AND 9 OR EXTRACT(HOUR FROM ts) BETWEEN 17 AND 18
   OR (EXTRACT(DOW FROM ts) IN (0,6) AND EXTRACT(HOUR FROM ts) BETWEEN 10 AND 16);

-- ============================================================
-- 38. SAFETY SNAPSHOTS — last 90 days
-- ============================================================
INSERT INTO safety_snapshots (vehicle_id, automatic_blind_spot_camera, automatic_emergency_braking_off,
  blind_spot_collision_warning, cruise_follow_distance, emergency_lane_departure_avoidance,
  forward_collision_warning, lane_departure_avoidance, speed_limit_warning,
  pin_to_drive_enabled, miles_since_reset, self_driving_miles_since_reset, created_at)
SELECT 1, true, false, true, '3', true, true, true, 'Display',
  false,
  1000 + (EXTRACT(EPOCH FROM ts - (NOW() - INTERVAL '90 days')) / 86400) * 40,
  500 + (EXTRACT(EPOCH FROM ts - (NOW() - INTERVAL '90 days')) / 86400) * 20,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '6 hours') ts;

-- ============================================================
-- 39. USER PREFERENCE SNAPSHOTS — last 90 days
-- ============================================================
INSERT INTO user_preference_snapshots (vehicle_id, setting_24hr_time, setting_charge_unit,
  setting_distance_unit, setting_temperature_unit, setting_tire_pressure_unit, created_at)
SELECT 1, false, 'mi', 'mi', 'F', 'PSI', ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '1 day') ts;

-- ============================================================
-- 40. VEHICLE CONFIG SNAPSHOTS — last 90 days
-- ============================================================
INSERT INTO vehicle_config_snapshots (vehicle_id, car_type, trim, exterior_color, roof_color, wheel_type,
  rear_seat_heaters, sunroof_installed, efficiency_package, europe_vehicle, right_hand_drive,
  remote_start_enabled, charge_port, offroad_lightbar_present, version, vehicle_name,
  software_update_version, software_update_download_pct, software_update_install_pct,
  software_update_expected_duration, created_at)
SELECT 1, 'modely', 'Long Range', 'PearlWhite', 'Glass', 'Gemini19',
  true, false, false, false, false,
  true, 'US', false, NULL, 'Test Model Y',
  '2026.2.1', 100, 100, 0,
  ts
FROM generate_series(NOW() - INTERVAL '90 days', NOW(), '1 day') ts;

-- ============================================================
-- 41. CHATBOT MESSAGES — sample conversation
-- ============================================================
INSERT INTO chatbot_messages (session_id, role, content, created_at) VALUES
  ('sess_001', 'user',      'How much did I spend on charging last month?', NOW() - INTERVAL '2 days'),
  ('sess_001', 'assistant', 'Based on your charging data, you spent approximately $38.50 on home charging and $12.40 on Supercharging last month, totaling $50.90.', NOW() - INTERVAL '2 days' + INTERVAL '5 seconds'),
  ('sess_001', 'user',      'What is my battery health?', NOW() - INTERVAL '2 days' + INTERVAL '1 minute'),
  ('sess_001', 'assistant', 'Your battery health is at 92.3% after 6 years of ownership. Degradation of 7.7% is well within the expected range for a Model Y Long Range with ~1,200 charge cycles.', NOW() - INTERVAL '2 days' + INTERVAL '1 minute 5 seconds');

-- ============================================================
-- 42. EXPORT JOBS — a completed export
-- ============================================================
INSERT INTO export_jobs (id, type, format, status, vehicle_id, start_date, end_date, file_name, file_data, file_size, record_count, error_message, created_at, updated_at, completed_at) VALUES
  ('exp_2026_q1', 'drives', 'csv', 'completed', 1, '2026-01-01', '2026-03-31', 'drives_2026_q1.csv', NULL, 245000, 450, NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');

-- ============================================================
-- 43. TRIP_DRIVES — link some drives to trips
-- ============================================================
INSERT INTO trip_drives (trip_id, drive_id)
SELECT t.id, d.id
FROM trips t
JOIN drives d ON d.start_date >= t.start_date AND d.start_date < t.end_date AND d.vehicle_id = t.vehicle_id
WHERE d.id % 10 = 0  -- sample ~10% of drives per trip to keep it manageable
LIMIT 500;

COMMIT;
