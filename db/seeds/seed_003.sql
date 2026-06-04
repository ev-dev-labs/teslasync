-- Seed data for new feature tables (migration 003)
BEGIN;

-- ============================================================
-- VEHICLE STATES (last 30 days of state transitions)
-- ============================================================
INSERT INTO vehicle_states (vehicle_id, state, start_date, end_date, duration_min) VALUES
  -- Vehicle 1: typical commuter pattern
  (1, 'asleep',   NOW() - INTERVAL '30 days',                          NOW() - INTERVAL '29 days' + TIME '08:10', 1450),
  (1, 'online',   NOW() - INTERVAL '29 days' + TIME '08:10',           NOW() - INTERVAL '29 days' + TIME '08:15', 5),
  (1, 'driving',  NOW() - INTERVAL '29 days' + TIME '08:15',           NOW() - INTERVAL '29 days' + TIME '08:52', 37),
  (1, 'online',   NOW() - INTERVAL '29 days' + TIME '08:52',           NOW() - INTERVAL '29 days' + TIME '09:10', 18),
  (1, 'asleep',   NOW() - INTERVAL '29 days' + TIME '09:10',           NOW() - INTERVAL '29 days' + TIME '17:25', 495),
  (1, 'online',   NOW() - INTERVAL '29 days' + TIME '17:25',           NOW() - INTERVAL '29 days' + TIME '17:30', 5),
  (1, 'driving',  NOW() - INTERVAL '29 days' + TIME '17:30',           NOW() - INTERVAL '29 days' + TIME '18:12', 42),
  (1, 'online',   NOW() - INTERVAL '29 days' + TIME '18:12',           NOW() - INTERVAL '29 days' + TIME '18:30', 18),
  (1, 'charging', NOW() - INTERVAL '29 days' + TIME '22:00',           NOW() - INTERVAL '28 days' + TIME '05:30', 450),
  (1, 'asleep',   NOW() - INTERVAL '28 days' + TIME '05:30',           NOW() - INTERVAL '27 days' + TIME '08:15', 1605),
  (1, 'driving',  NOW() - INTERVAL '27 days' + TIME '08:20',           NOW() - INTERVAL '27 days' + TIME '08:55', 35),
  (1, 'asleep',   NOW() - INTERVAL '27 days' + TIME '09:10',           NOW() - INTERVAL '27 days' + TIME '17:40', 510),
  (1, 'driving',  NOW() - INTERVAL '27 days' + TIME '17:45',           NOW() - INTERVAL '27 days' + TIME '18:30', 45),
  (1, 'charging', NOW() - INTERVAL '27 days' + TIME '22:00',           NOW() - INTERVAL '26 days' + TIME '04:45', 405),
  (1, 'asleep',   NOW() - INTERVAL '26 days',                          NOW() - INTERVAL '25 days' + TIME '08:05', 1445),
  (1, 'driving',  NOW() - INTERVAL '25 days' + TIME '08:10',           NOW() - INTERVAL '25 days' + TIME '08:48', 38),
  (1, 'asleep',   NOW() - INTERVAL '25 days' + TIME '09:00',           NOW() - INTERVAL '25 days' + TIME '17:10', 490),
  (1, 'driving',  NOW() - INTERVAL '25 days' + TIME '17:15',           NOW() - INTERVAL '25 days' + TIME '17:58', 43),
  (1, 'charging', NOW() - INTERVAL '25 days' + TIME '22:00',           NOW() - INTERVAL '24 days' + TIME '05:00', 420),
  -- Weekend trip
  (1, 'driving',  NOW() - INTERVAL '22 days' + TIME '09:00',           NOW() - INTERVAL '22 days' + TIME '10:15', 75),
  (1, 'charging', NOW() - INTERVAL '22 days' + TIME '12:00',           NOW() - INTERVAL '22 days' + TIME '12:35', 35),
  (1, 'driving',  NOW() - INTERVAL '22 days' + TIME '16:00',           NOW() - INTERVAL '22 days' + TIME '17:20', 80),
  -- Big Sur trip
  (1, 'driving',  NOW() - INTERVAL '15 days' + TIME '06:30',           NOW() - INTERVAL '15 days' + TIME '09:45', 195),
  (1, 'charging', NOW() - INTERVAL '15 days' + TIME '10:30',           NOW() - INTERVAL '15 days' + TIME '11:05', 35),
  (1, 'driving',  NOW() - INTERVAL '14 days' + TIME '14:00',           NOW() - INTERVAL '14 days' + TIME '17:10', 190),
  (1, 'charging', NOW() - INTERVAL '14 days' + TIME '22:00',           NOW() - INTERVAL '13 days' + TIME '06:00', 480),
  -- Recent days
  (1, 'driving',  NOW() - INTERVAL '10 days' + TIME '08:20',           NOW() - INTERVAL '10 days' + TIME '08:58', 38),
  (1, 'driving',  NOW() - INTERVAL '7 days'  + TIME '08:15',           NOW() - INTERVAL '7 days'  + TIME '08:50', 35),
  (1, 'driving',  NOW() - INTERVAL '5 days'  + TIME '08:22',           NOW() - INTERVAL '5 days'  + TIME '08:57', 35),
  (1, 'driving',  NOW() - INTERVAL '3 days'  + TIME '09:00',           NOW() - INTERVAL '3 days'  + TIME '10:30', 90),
  (1, 'driving',  NOW() - INTERVAL '3 days'  + TIME '16:30',           NOW() - INTERVAL '3 days'  + TIME '18:05', 95),
  (1, 'driving',  NOW() - INTERVAL '1 day'   + TIME '08:20',           NOW() - INTERVAL '1 day'   + TIME '08:55', 35),
  (1, 'online',   NOW() - INTERVAL '2 hours',                          NULL, NULL),

  -- Vehicle 2: mostly parked, weekend trips
  (2, 'asleep',   NOW() - INTERVAL '30 days',                          NOW() - INTERVAL '28 days' + TIME '09:50', 2870),
  (2, 'driving',  NOW() - INTERVAL '28 days' + TIME '10:00',           NOW() - INTERVAL '28 days' + TIME '13:30', 210),
  (2, 'charging', NOW() - INTERVAL '28 days' + TIME '14:00',           NOW() - INTERVAL '28 days' + TIME '14:25', 25),
  (2, 'driving',  NOW() - INTERVAL '27 days' + TIME '11:00',           NOW() - INTERVAL '27 days' + TIME '14:20', 200),
  (2, 'charging', NOW() - INTERVAL '27 days' + TIME '22:00',           NOW() - INTERVAL '26 days' + TIME '06:00', 480),
  (2, 'asleep',   NOW() - INTERVAL '26 days',                          NOW() - INTERVAL '21 days' + TIME '09:20', 7160),
  (2, 'driving',  NOW() - INTERVAL '21 days' + TIME '09:30',           NOW() - INTERVAL '21 days' + TIME '11:00', 90),
  (2, 'driving',  NOW() - INTERVAL '21 days' + TIME '16:00',           NOW() - INTERVAL '21 days' + TIME '17:25', 85),
  (2, 'charging', NOW() - INTERVAL '21 days' + TIME '22:00',           NOW() - INTERVAL '20 days' + TIME '05:00', 420),
  (2, 'asleep',   NOW() - INTERVAL '20 days',                          NOW() - INTERVAL '14 days' + TIME '06:50', 8690),
  (2, 'driving',  NOW() - INTERVAL '14 days' + TIME '07:00',           NOW() - INTERVAL '14 days' + TIME '10:45', 225),
  (2, 'charging', NOW() - INTERVAL '14 days' + TIME '11:30',           NOW() - INTERVAL '14 days' + TIME '12:00', 30),
  (2, 'driving',  NOW() - INTERVAL '13 days' + TIME '15:00',           NOW() - INTERVAL '13 days' + TIME '18:30', 210),
  (2, 'charging', NOW() - INTERVAL '13 days' + TIME '22:00',           NOW() - INTERVAL '12 days' + TIME '06:30', 510),
  (2, 'asleep',   NOW() - INTERVAL '12 days',                          NOW() - INTERVAL '7 days'  + TIME '10:50', 7250),
  (2, 'driving',  NOW() - INTERVAL '7 days'  + TIME '11:00',           NOW() - INTERVAL '7 days'  + TIME '12:15', 75),
  (2, 'charging', NOW() - INTERVAL '7 days'  + TIME '22:00',           NOW() - INTERVAL '6 days'  + TIME '04:30', 390),
  (2, 'asleep',   NOW() - INTERVAL '6 days',                           NOW() - INTERVAL '2 days'  + TIME '09:50', 5750),
  (2, 'driving',  NOW() - INTERVAL '2 days'  + TIME '10:00',           NOW() - INTERVAL '2 days'  + TIME '11:30', 90),
  (2, 'charging', NOW() - INTERVAL '2 days'  + TIME '22:00',           NOW() - INTERVAL '1 day'   + TIME '05:00', 420),
  (2, 'asleep',   NOW() - INTERVAL '1 day'   + TIME '05:00',           NULL, NULL),

  -- Vehicle 3: daily driver
  (3, 'asleep',   NOW() - INTERVAL '30 days',                          NOW() - INTERVAL '25 days' + TIME '07:50', 7190),
  (3, 'driving',  NOW() - INTERVAL '25 days' + TIME '08:00',           NOW() - INTERVAL '25 days' + TIME '08:40', 40),
  (3, 'asleep',   NOW() - INTERVAL '25 days' + TIME '09:00',           NOW() - INTERVAL '25 days' + TIME '17:20', 500),
  (3, 'driving',  NOW() - INTERVAL '25 days' + TIME '17:30',           NOW() - INTERVAL '25 days' + TIME '18:15', 45),
  (3, 'charging', NOW() - INTERVAL '25 days' + TIME '22:00',           NOW() - INTERVAL '24 days' + TIME '05:00', 420),
  (3, 'driving',  NOW() - INTERVAL '20 days' + TIME '09:00',           NOW() - INTERVAL '20 days' + TIME '10:35', 95),
  (3, 'driving',  NOW() - INTERVAL '20 days' + TIME '16:00',           NOW() - INTERVAL '20 days' + TIME '17:40', 100),
  (3, 'charging', NOW() - INTERVAL '20 days' + TIME '22:00',           NOW() - INTERVAL '19 days' + TIME '05:30', 450),
  (3, 'driving',  NOW() - INTERVAL '15 days' + TIME '08:10',           NOW() - INTERVAL '15 days' + TIME '08:45', 35),
  (3, 'driving',  NOW() - INTERVAL '12 days' + TIME '08:15',           NOW() - INTERVAL '12 days' + TIME '08:50', 35),
  (3, 'driving',  NOW() - INTERVAL '8 days'  + TIME '07:00',           NOW() - INTERVAL '8 days'  + TIME '10:20', 200),
  (3, 'charging', NOW() - INTERVAL '8 days'  + TIME '11:00',           NOW() - INTERVAL '8 days'  + TIME '11:30', 30),
  (3, 'driving',  NOW() - INTERVAL '7 days'  + TIME '12:00',           NOW() - INTERVAL '7 days'  + TIME '15:15', 195),
  (3, 'charging', NOW() - INTERVAL '7 days'  + TIME '22:00',           NOW() - INTERVAL '6 days'  + TIME '07:00', 540),
  (3, 'driving',  NOW() - INTERVAL '4 days'  + TIME '08:20',           NOW() - INTERVAL '4 days'  + TIME '08:55', 35),
  (3, 'driving',  NOW() - INTERVAL '1 day'   + TIME '09:00',           NOW() - INTERVAL '1 day'   + TIME '09:35', 35),
  (3, 'online',   NOW() - INTERVAL '1 hour',                           NULL, NULL);

-- ============================================================
-- VAMPIRE DRAIN EVENTS
-- ============================================================
INSERT INTO vampire_drain_events (vehicle_id, start_date, end_date, start_battery, end_battery, battery_lost, range_lost_km, duration_hours, drain_rate_pct_per_hour, outside_temp_avg, sentry_mode) VALUES
  -- Vehicle 1: moderate drain
  (1, NOW() - INTERVAL '29 days' + TIME '09:10', NOW() - INTERVAL '29 days' + TIME '17:25', 75, 73, 2, 9.5, 8.25, 0.24, 16.2, false),
  (1, NOW() - INTERVAL '27 days' + TIME '09:10', NOW() - INTERVAL '27 days' + TIME '17:40', 79, 76, 3, 14.2, 8.5, 0.35, 15.8, true),
  (1, NOW() - INTERVAL '25 days' + TIME '09:00', NOW() - INTERVAL '25 days' + TIME '17:10', 83, 81, 2, 9.5, 8.17, 0.24, 16.5, false),
  (1, NOW() - INTERVAL '20 days' + TIME '09:05', NOW() - INTERVAL '20 days' + TIME '17:00', 77, 75, 2, 9.5, 7.92, 0.25, 16.0, false),
  (1, NOW() - INTERVAL '18 days' + TIME '09:00', NOW() - INTERVAL '18 days' + TIME '17:00', 80, 77, 3, 14.2, 8.0, 0.38, 15.5, true),
  (1, NOW() - INTERVAL '10 days' + TIME '09:00', NOW() - INTERVAL '10 days' + TIME '17:00', 81, 79, 2, 9.5, 8.0, 0.25, 16.8, false),
  (1, NOW() - INTERVAL '7 days'  + TIME '09:00', NOW() - INTERVAL '7 days'  + TIME '17:00', 78, 76, 2, 9.5, 8.0, 0.25, 15.2, false),
  (1, NOW() - INTERVAL '5 days'  + TIME '09:00', NOW() - INTERVAL '5 days'  + TIME '17:00', 82, 80, 2, 9.5, 8.0, 0.25, 16.3, false),

  -- Vehicle 2: higher drain (bigger battery, more sentry)
  (2, NOW() - INTERVAL '26 days', NOW() - INTERVAL '21 days' + TIME '09:20', 88, 82, 6, 35.5, 129.3, 0.05, 14.0, true),
  (2, NOW() - INTERVAL '20 days', NOW() - INTERVAL '14 days' + TIME '06:50', 87, 80, 7, 41.3, 150.8, 0.05, 13.5, true),
  (2, NOW() - INTERVAL '12 days', NOW() - INTERVAL '7 days'  + TIME '10:50', 88, 82, 6, 35.5, 122.8, 0.05, 15.0, true),
  (2, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '2 days'  + TIME '09:50', 86, 80, 6, 35.5, 97.8, 0.06, 16.0, true),

  -- Vehicle 3: low drain
  (3, NOW() - INTERVAL '25 days' + TIME '09:00', NOW() - INTERVAL '25 days' + TIME '17:20', 81, 80, 1, 4.8, 8.33, 0.12, 15.5, false),
  (3, NOW() - INTERVAL '15 days' + TIME '09:00', NOW() - INTERVAL '15 days' + TIME '17:00', 84, 83, 1, 4.8, 8.0, 0.13, 15.0, false),
  (3, NOW() - INTERVAL '12 days' + TIME '09:00', NOW() - INTERVAL '12 days' + TIME '17:00', 82, 81, 1, 4.8, 8.0, 0.13, 16.2, false),
  (3, NOW() - INTERVAL '4 days'  + TIME '09:00', NOW() - INTERVAL '4 days'  + TIME '17:00', 83, 82, 1, 4.8, 8.0, 0.13, 15.8, false);

-- ============================================================
-- DAILY MILEAGE
-- ============================================================
INSERT INTO daily_mileage (vehicle_id, date, distance_km, odometer_start, odometer_end, drive_count, energy_used_kwh) VALUES
  -- Vehicle 1 (commuter)
  (1, (NOW() - INTERVAL '29 days')::DATE, 106.4, 45020, 45126.4, 2, 17.5),
  (1, (NOW() - INTERVAL '27 days')::DATE, 105.3, 45126.4, 45231.7, 2, 17.2),
  (1, (NOW() - INTERVAL '25 days')::DATE, 104.8, 45231.7, 45336.5, 2, 17.0),
  (1, (NOW() - INTERVAL '22 days')::DATE, 198.7, 45336.5, 45535.2, 2, 35.0),
  (1, (NOW() - INTERVAL '20 days')::DATE, 51.5,  45535.2, 45586.7, 1, 8.5),
  (1, (NOW() - INTERVAL '18 days')::DATE, 52.1,  45586.7, 45638.8, 1, 8.6),
  (1, (NOW() - INTERVAL '15 days')::DATE, 240.5, 45638.8, 45879.3, 1, 42.0),
  (1, (NOW() - INTERVAL '14 days')::DATE, 238.8, 45879.3, 46118.1, 1, 41.5),
  (1, (NOW() - INTERVAL '10 days')::DATE, 53.0,  46118.1, 46171.1, 1, 8.7),
  (1, (NOW() - INTERVAL '7 days')::DATE,  51.9,  46171.1, 46223.0, 1, 8.5),
  (1, (NOW() - INTERVAL '5 days')::DATE,  52.4,  46223.0, 46275.4, 1, 8.6),
  (1, (NOW() - INTERVAL '3 days')::DATE,  232.7, 46275.4, 46508.1, 2, 40.5),
  (1, (NOW() - INTERVAL '1 day')::DATE,   52.0,  46508.1, 46560.1, 1, 8.5),
  -- Vehicle 2 (weekend)
  (2, (NOW() - INTERVAL '28 days')::DATE, 310.5, 68000, 68310.5, 1, 55.0),
  (2, (NOW() - INTERVAL '27 days')::DATE, 308.2, 68310.5, 68618.7, 1, 54.0),
  (2, (NOW() - INTERVAL '21 days')::DATE, 191.3, 68618.7, 68810.0, 2, 32.0),
  (2, (NOW() - INTERVAL '14 days')::DATE, 195.0, 68810.0, 69005.0, 1, 34.0),
  (2, (NOW() - INTERVAL '13 days')::DATE, 192.5, 69005.0, 69197.5, 1, 33.5),
  (2, (NOW() - INTERVAL '7 days')::DATE,  62.0,  69197.5, 69259.5, 1, 10.5),
  (2, (NOW() - INTERVAL '2 days')::DATE,  115.0, 69259.5, 69374.5, 1, 19.5),
  -- Vehicle 3 (mixed)
  (3, (NOW() - INTERVAL '25 days')::DATE, 105.2, 31950, 32055.2, 2, 17.5),
  (3, (NOW() - INTERVAL '20 days')::DATE, 195.5, 32055.2, 32250.7, 2, 34.0),
  (3, (NOW() - INTERVAL '15 days')::DATE, 51.5,  32250.7, 32302.2, 1, 8.5),
  (3, (NOW() - INTERVAL '12 days')::DATE, 52.3,  32302.2, 32354.5, 1, 8.6),
  (3, (NOW() - INTERVAL '8 days')::DATE,  305.0, 32354.5, 32659.5, 1, 53.0),
  (3, (NOW() - INTERVAL '7 days')::DATE,  302.8, 32659.5, 32962.3, 1, 52.5),
  (3, (NOW() - INTERVAL '4 days')::DATE,  51.8,  32962.3, 33014.1, 1, 8.5),
  (3, (NOW() - INTERVAL '1 day')::DATE,   52.5,  33014.1, 33066.6, 1, 8.6);

-- ============================================================
-- VISITED LOCATIONS
-- ============================================================
INSERT INTO visited_locations (vehicle_id, address_id, visit_count, total_duration_min, last_visited) VALUES
  (1, 1, 45,  18000, NOW() - INTERVAL '1 day'),       -- Home
  (1, 2, 35,  14400, NOW() - INTERVAL '1 day'),       -- Office
  (1, 3, 3,   90,    NOW() - INTERVAL '3 days'),      -- SF Supercharger
  (1, 4, 2,   180,   NOW() - INTERVAL '22 days'),     -- Napa Valley
  (1, 7, 1,   1440,  NOW() - INTERVAL '15 days'),     -- Big Sur
  (1, 9, 1,   180,   NOW() - INTERVAL '3 days'),      -- Santa Cruz
  (2, 1, 20,  14000, NOW() - INTERVAL '1 day'),       -- Home
  (2, 4, 2,   150,   NOW() - INTERVAL '21 days'),     -- Napa
  (2, 5, 1,   120,   NOW() - INTERVAL '7 days'),      -- Tesla Fremont
  (2, 8, 2,   2880,  NOW() - INTERVAL '28 days'),     -- Yosemite
  (2, 9, 1,   120,   NOW() - INTERVAL '2 days'),      -- Santa Cruz
  (2, 10, 1,  240,   NOW() - INTERVAL '14 days'),     -- Monterey
  (3, 1, 30,  12000, NOW() - INTERVAL '1 day'),       -- Home
  (3, 2, 25,  10000, NOW() - INTERVAL '1 day'),       -- Office
  (3, 4, 1,   120,   NOW() - INTERVAL '20 days'),     -- Napa
  (3, 8, 1,   1440,  NOW() - INTERVAL '8 days');      -- Yosemite

-- ============================================================
-- TRIPS (multi-drive journeys)
-- ============================================================
INSERT INTO trips (id, vehicle_id, name, start_date, end_date, total_distance_km, total_energy_kwh, total_cost, drive_count, charge_count) VALUES
  (1, 1, 'Napa Valley Weekend',     NOW() - INTERVAL '22 days' + TIME '09:00', NOW() - INTERVAL '22 days' + TIME '17:20', 198.7, 35.0, 5.69, 2, 1),
  (2, 1, 'Big Sur Road Trip',       NOW() - INTERVAL '15 days' + TIME '06:30', NOW() - INTERVAL '14 days' + TIME '17:10', 479.3, 83.5, 11.76, 2, 2),
  (3, 1, 'Santa Cruz Day Trip',     NOW() - INTERVAL '3 days'  + TIME '09:00', NOW() - INTERVAL '3 days'  + TIME '18:05', 232.7, 40.5, 4.80, 2, 1),
  (4, 2, 'Yosemite Adventure',      NOW() - INTERVAL '28 days' + TIME '10:00', NOW() - INTERVAL '27 days' + TIME '14:20', 618.7, 109.0, 16.24, 2, 2),
  (5, 2, 'Monterey Coastal Drive',  NOW() - INTERVAL '14 days' + TIME '07:00', NOW() - INTERVAL '13 days' + TIME '18:30', 387.5, 67.5, 14.56, 2, 2),
  (6, 3, 'Yosemite Expedition',     NOW() - INTERVAL '8 days'  + TIME '07:00', NOW() - INTERVAL '7 days'  + TIME '15:15', 607.8, 105.5, 16.24, 2, 2);

SELECT setval('trips_id_seq', (SELECT MAX(id) FROM trips));

INSERT INTO trip_drives (trip_id, drive_id) VALUES
  (1, 7), (1, 8),
  (2, 11), (2, 12),
  (3, 16), (3, 17),
  (4, 19), (4, 20),
  (5, 23), (5, 24),
  (6, 33), (6, 34);

-- ============================================================
-- TIRE PRESSURE SNAPSHOTS
-- ============================================================
INSERT INTO tire_pressure_snapshots (vehicle_id, front_left, front_right, rear_left, rear_right, created_at) VALUES
  (1, 2.9, 2.9, 2.9, 2.9, NOW() - INTERVAL '30 days'),
  (1, 2.8, 2.9, 2.8, 2.9, NOW() - INTERVAL '20 days'),
  (1, 2.9, 2.9, 2.9, 2.8, NOW() - INTERVAL '10 days'),
  (1, 2.8, 2.8, 2.9, 2.9, NOW() - INTERVAL '1 day'),
  (2, 3.0, 3.0, 3.0, 3.0, NOW() - INTERVAL '28 days'),
  (2, 2.9, 3.0, 2.9, 3.0, NOW() - INTERVAL '14 days'),
  (2, 3.0, 2.9, 3.0, 2.9, NOW() - INTERVAL '2 days'),
  (3, 2.9, 2.9, 2.8, 2.8, NOW() - INTERVAL '25 days'),
  (3, 2.8, 2.8, 2.8, 2.8, NOW() - INTERVAL '12 days'),
  (3, 2.9, 2.9, 2.9, 2.9, NOW() - INTERVAL '1 day');

COMMIT;
