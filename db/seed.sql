-- TeslaSync Sample Seed Data
-- Run: docker exec -i teslasync-postgres psql -U teslasync -d teslasync < db/seed.sql

BEGIN;

-- ============================================================
-- 1. VEHICLES (3 Teslas)
-- ============================================================
INSERT INTO vehicles (id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, created_at, updated_at)
VALUES
  (1, 1492834567, '5YJ3E1EA8PF123456', 'Midnight Runner',  'Model 3', 'P',    'MidnightSilver', 'Pinwheel18',    'online',  true, NOW() - INTERVAL '14 months', NOW()),
  (2, 1587291034, '5YJSA1E47MF789012', 'Shadow',           'Model S', 'Plaid', 'SolidBlack',     'Turbine21',     'asleep',  true, NOW() - INTERVAL '10 months', NOW()),
  (3, 1623845901, '7SAYGDEE5PA345678', 'Ghost',            'Model Y', 'Long Range', 'PearlWhite', 'Gemini19', 'online',  true, NOW() - INTERVAL '6 months',  NOW())
ON CONFLICT (id) DO NOTHING;

SELECT setval('vehicles_id_seq', (SELECT MAX(id) FROM vehicles));

-- ============================================================
-- 2. ADDRESSES
-- ============================================================
INSERT INTO addresses (id, display_name, latitude, longitude, name, road, city, state, country, postcode, created_at)
VALUES
  (1, 'Home',                    37.7749, -122.4194, 'Home',               'Market St',       'San Francisco', 'CA', 'US', '94105', NOW()),
  (2, 'Office',                  37.3861, -122.0839, 'Googleplex',         'Amphitheatre Pkwy','Mountain View','CA', 'US', '94043', NOW()),
  (3, 'Tesla Supercharger SF',   37.7577, -122.3887, 'Supercharger',       'Brannan St',       'San Francisco', 'CA', 'US', '94107', NOW()),
  (4, 'Napa Valley Winery',      38.2975, -122.2869, 'Napa Valley',        'Silverado Trail',  'Napa',          'CA', 'US', '94558', NOW()),
  (5, 'Tesla Fremont Factory',   37.4925, -121.9446, 'Tesla Factory',      'Kato Rd',          'Fremont',       'CA', 'US', '94538', NOW()),
  (6, 'Palo Alto Supercharger',  37.4419, -122.1430, 'Supercharger',       'El Camino Real',   'Palo Alto',     'CA', 'US', '94301', NOW()),
  (7, 'Big Sur',                 36.2704, -121.8081, 'Big Sur',            'Cabrillo Hwy',     'Big Sur',       'CA', 'US', '93920', NOW()),
  (8, 'Yosemite Valley',         37.7456, -119.5936, 'Yosemite',           'Yosemite Valley',  'Yosemite',      'CA', 'US', '95389', NOW()),
  (9, 'Santa Cruz Beach',        36.9741, -122.0308, 'Santa Cruz',         'Beach St',         'Santa Cruz',    'CA', 'US', '95060', NOW()),
  (10,'Monterey Wharf',          36.6002, -121.8947, 'Monterey',           'Fishermans Wharf',  'Monterey',     'CA', 'US', '93940', NOW())
ON CONFLICT (id) DO NOTHING;

SELECT setval('addresses_id_seq', (SELECT MAX(id) FROM addresses));

-- ============================================================
-- 3. DRIVES (spread over last 30 days, linked to vehicles)
-- ============================================================
INSERT INTO drives (id, vehicle_id, start_date, end_date, start_address_id, end_address_id, distance, duration_min,
                    start_range_km, end_range_km, speed_max, power_max, power_min,
                    start_battery_level, end_battery_level, inside_temp_avg, outside_temp_avg)
VALUES
  -- Vehicle 1 (Model 3) - daily commuter + weekend trips
  (1,  1, NOW() - INTERVAL '29 days' + TIME '08:15', NOW() - INTERVAL '29 days' + TIME '08:52', 1, 2, 52.3, 37, 380, 342, 135, 180, -55, 85, 75, 21.5, 16.2),
  (2,  1, NOW() - INTERVAL '29 days' + TIME '17:30', NOW() - INTERVAL '29 days' + TIME '18:12', 2, 1, 54.1, 42, 320, 280, 128, 165, -48, 72, 62, 22.0, 18.5),
  (3,  1, NOW() - INTERVAL '27 days' + TIME '08:20', NOW() - INTERVAL '27 days' + TIME '08:55', 1, 2, 51.8, 35, 395, 358, 132, 175, -52, 88, 79, 21.0, 15.8),
  (4,  1, NOW() - INTERVAL '27 days' + TIME '17:45', NOW() - INTERVAL '27 days' + TIME '18:30', 2, 1, 53.5, 45, 340, 301, 126, 160, -45, 76, 66, 22.5, 19.0),
  (5,  1, NOW() - INTERVAL '25 days' + TIME '08:10', NOW() - INTERVAL '25 days' + TIME '08:48', 1, 2, 52.0, 38, 410, 372, 130, 170, -50, 92, 83, 21.2, 16.5),
  (6,  1, NOW() - INTERVAL '25 days' + TIME '17:15', NOW() - INTERVAL '25 days' + TIME '17:58', 2, 1, 52.8, 43, 355, 316, 125, 155, -42, 79, 70, 22.8, 19.2),
  (7,  1, NOW() - INTERVAL '22 days' + TIME '09:00', NOW() - INTERVAL '22 days' + TIME '10:15', 1, 4, 98.5, 75, 400, 328, 145, 210, -65, 90, 72, 21.0, 17.5),
  (8,  1, NOW() - INTERVAL '22 days' + TIME '16:00', NOW() - INTERVAL '22 days' + TIME '17:20', 4, 1, 100.2, 80, 310, 237, 140, 205, -60, 70, 51, 22.0, 18.8),
  (9,  1, NOW() - INTERVAL '20 days' + TIME '08:25', NOW() - INTERVAL '20 days' + TIME '09:00', 1, 2, 51.5, 35, 385, 348, 128, 168, -48, 86, 77, 21.8, 16.0),
  (10, 1, NOW() - INTERVAL '18 days' + TIME '08:18', NOW() - INTERVAL '18 days' + TIME '08:53', 1, 2, 52.1, 35, 395, 357, 131, 172, -51, 89, 80, 21.3, 15.5),
  (11, 1, NOW() - INTERVAL '15 days' + TIME '06:30', NOW() - INTERVAL '15 days' + TIME '09:45', 1, 7, 240.5, 195, 420, 246, 155, 280, -80, 95, 50, 20.5, 14.2),
  (12, 1, NOW() - INTERVAL '14 days' + TIME '14:00', NOW() - INTERVAL '14 days' + TIME '17:10', 7, 1, 238.8, 190, 280, 100, 150, 270, -75, 60, 15, 21.0, 16.0),
  (13, 1, NOW() - INTERVAL '10 days' + TIME '08:20', NOW() - INTERVAL '10 days' + TIME '08:58', 1, 2, 53.0, 38, 400, 361, 133, 175, -53, 90, 81, 21.5, 16.8),
  (14, 1, NOW() - INTERVAL '7 days'  + TIME '08:15', NOW() - INTERVAL '7 days'  + TIME '08:50', 1, 2, 51.9, 35, 390, 353, 129, 169, -49, 87, 78, 21.0, 15.2),
  (15, 1, NOW() - INTERVAL '5 days'  + TIME '08:22', NOW() - INTERVAL '5 days'  + TIME '08:57', 1, 2, 52.4, 35, 405, 367, 130, 171, -50, 91, 82, 21.4, 16.3),
  (16, 1, NOW() - INTERVAL '3 days'  + TIME '09:00', NOW() - INTERVAL '3 days'  + TIME '10:30', 1, 9, 115.5, 90, 395, 312, 142, 220, -62, 89, 68, 20.8, 17.0),
  (17, 1, NOW() - INTERVAL '3 days'  + TIME '16:30', NOW() - INTERVAL '3 days'  + TIME '18:05', 9, 1, 117.2, 95, 290, 205, 138, 215, -58, 65, 44, 22.0, 18.5),
  (18, 1, NOW() - INTERVAL '1 day'   + TIME '08:20', NOW() - INTERVAL '1 day'   + TIME '08:55', 1, 2, 52.0, 35, 410, 373, 131, 170, -50, 92, 83, 21.2, 16.0),

  -- Vehicle 2 (Model S Plaid) - weekend warrior, longer trips
  (19, 2, NOW() - INTERVAL '28 days' + TIME '10:00', NOW() - INTERVAL '28 days' + TIME '13:30', 1, 8, 310.5, 210, 580, 345, 165, 350, -95, 92, 40, 20.0, 12.5),
  (20, 2, NOW() - INTERVAL '27 days' + TIME '11:00', NOW() - INTERVAL '27 days' + TIME '14:20', 8, 1, 308.2, 200, 380, 85,  160, 340, -90, 60, 10, 21.0, 14.0),
  (21, 2, NOW() - INTERVAL '21 days' + TIME '09:30', NOW() - INTERVAL '21 days' + TIME '11:00', 1, 4, 95.0,  90, 560, 475, 148, 250, -70, 90, 74, 21.2, 16.8),
  (22, 2, NOW() - INTERVAL '21 days' + TIME '16:00', NOW() - INTERVAL '21 days' + TIME '17:25', 4, 1, 96.3,  85, 450, 365, 145, 240, -65, 72, 57, 22.0, 18.2),
  (23, 2, NOW() - INTERVAL '14 days' + TIME '07:00', NOW() - INTERVAL '14 days' + TIME '10:45', 1, 10, 195.0, 225, 570, 385, 158, 310, -85, 91, 58, 20.5, 13.5),
  (24, 2, NOW() - INTERVAL '13 days' + TIME '15:00', NOW() - INTERVAL '13 days' + TIME '18:30', 10, 1, 192.5, 210, 400, 220, 155, 300, -80, 65, 32, 21.5, 15.0),
  (25, 2, NOW() - INTERVAL '7 days'  + TIME '11:00', NOW() - INTERVAL '7 days'  + TIME '12:15', 1, 5, 62.0,  75, 540, 485, 140, 230, -60, 87, 77, 21.8, 17.5),
  (26, 2, NOW() - INTERVAL '2 days'  + TIME '10:00', NOW() - INTERVAL '2 days'  + TIME '11:30', 1, 9, 115.0, 90, 555, 460, 150, 260, -68, 89, 70, 20.8, 16.0),

  -- Vehicle 3 (Model Y) - mixed use
  (27, 3, NOW() - INTERVAL '25 days' + TIME '08:00', NOW() - INTERVAL '25 days' + TIME '08:40', 1, 2, 52.0, 40, 430, 392, 125, 160, -45, 90, 81, 21.0, 15.5),
  (28, 3, NOW() - INTERVAL '25 days' + TIME '17:30', NOW() - INTERVAL '25 days' + TIME '18:15', 2, 1, 53.2, 45, 375, 337, 122, 155, -42, 78, 69, 22.2, 18.0),
  (29, 3, NOW() - INTERVAL '20 days' + TIME '09:00', NOW() - INTERVAL '20 days' + TIME '10:35', 1, 4, 97.0, 95, 420, 349, 138, 200, -58, 88, 70, 21.5, 16.8),
  (30, 3, NOW() - INTERVAL '20 days' + TIME '16:00', NOW() - INTERVAL '20 days' + TIME '17:40', 4, 1, 98.5, 100, 335, 262, 135, 195, -55, 69, 52, 22.0, 18.5),
  (31, 3, NOW() - INTERVAL '15 days' + TIME '08:10', NOW() - INTERVAL '15 days' + TIME '08:45', 1, 2, 51.5, 35, 445, 408, 126, 162, -46, 93, 84, 21.2, 15.0),
  (32, 3, NOW() - INTERVAL '12 days' + TIME '08:15', NOW() - INTERVAL '12 days' + TIME '08:50', 1, 2, 52.3, 35, 435, 397, 128, 165, -48, 91, 82, 21.4, 16.2),
  (33, 3, NOW() - INTERVAL '8 days'  + TIME '07:00', NOW() - INTERVAL '8 days'  + TIME '10:20', 1, 8, 305.0, 200, 450, 175, 160, 330, -88, 95, 42, 20.0, 13.0),
  (34, 3, NOW() - INTERVAL '7 days'  + TIME '12:00', NOW() - INTERVAL '7 days'  + TIME '15:15', 8, 1, 302.8, 195, 220, 0,   155, 320, -82, 45, 0,  21.0, 15.5),
  (35, 3, NOW() - INTERVAL '4 days'  + TIME '08:20', NOW() - INTERVAL '4 days'  + TIME '08:55', 1, 2, 51.8, 35, 440, 403, 127, 163, -47, 92, 83, 21.3, 15.8),
  (36, 3, NOW() - INTERVAL '1 day'   + TIME '09:00', NOW() - INTERVAL '1 day'   + TIME '09:35', 1, 2, 52.5, 35, 448, 410, 130, 168, -50, 94, 85, 21.0, 16.0)
ON CONFLICT (id) DO NOTHING;

SELECT setval('drives_id_seq', (SELECT MAX(id) FROM drives));

-- ============================================================
-- 4. CHARGING SESSIONS (home charging + supercharging)
-- ============================================================
INSERT INTO charging_sessions (id, vehicle_id, start_date, end_date, address_id, charge_energy_added, charge_energy_used,
                               start_battery_level, end_battery_level, start_range_km, end_range_km,
                               charger_phases, charger_voltage, charger_actual_current, charger_power,
                               fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min)
VALUES
  -- Vehicle 1 home charging (nightly)
  (1,  1, NOW() - INTERVAL '29 days' + TIME '22:00', NOW() - INTERVAL '29 days' + TIME '05:30', 1, 28.5, 30.2, 62, 92, 280, 400, 1, 240, 32, 7.7, '', '', 'SAE', 3.42, 450),
  (2,  1, NOW() - INTERVAL '27 days' + TIME '22:00', NOW() - INTERVAL '27 days' + TIME '04:45', 1, 25.0, 26.5, 66, 90, 301, 395, 1, 240, 32, 7.7, '', '', 'SAE', 3.00, 405),
  (3,  1, NOW() - INTERVAL '25 days' + TIME '22:00', NOW() - INTERVAL '25 days' + TIME '05:00', 1, 26.5, 28.0, 70, 92, 316, 405, 1, 240, 32, 7.7, '', '', 'SAE', 3.18, 420),
  (4,  1, NOW() - INTERVAL '22 days' + TIME '12:00', NOW() - INTERVAL '22 days' + TIME '12:35', 4, 15.8, 17.0, 51, 72, 237, 328, 3, 400, 148, 59, 'Tesla', 'Tesla', 'IEC', 5.69, 35),
  (5,  1, NOW() - INTERVAL '20 days' + TIME '22:00', NOW() - INTERVAL '20 days' + TIME '05:15', 1, 27.0, 28.5, 65, 91, 295, 400, 1, 240, 32, 7.7, '', '', 'SAE', 3.24, 435),
  (6,  1, NOW() - INTERVAL '18 days' + TIME '22:00', NOW() - INTERVAL '18 days' + TIME '04:30', 1, 24.5, 26.0, 68, 89, 310, 393, 1, 240, 32, 7.7, '', '', 'SAE', 2.94, 390),
  (7,  1, NOW() - INTERVAL '15 days' + TIME '10:30', NOW() - INTERVAL '15 days' + TIME '11:05', 7, 18.0, 19.5, 50, 70, 246, 320, 3, 400, 165, 66, 'Tesla', 'Tesla', 'IEC', 7.20, 35),
  (8,  1, NOW() - INTERVAL '14 days' + TIME '22:00', NOW() - INTERVAL '14 days' + TIME '06:00', 1, 38.0, 40.0, 15, 90, 100, 395, 1, 240, 32, 7.7, '', '', 'SAE', 4.56, 480),
  (9,  1, NOW() - INTERVAL '10 days' + TIME '22:00', NOW() - INTERVAL '10 days' + TIME '04:45', 1, 22.5, 24.0, 70, 89, 320, 393, 1, 240, 32, 7.7, '', '', 'SAE', 2.70, 405),
  (10, 1, NOW() - INTERVAL '7 days'  + TIME '22:00', NOW() - INTERVAL '7 days'  + TIME '05:00', 1, 25.0, 26.5, 67, 90, 305, 397, 1, 240, 32, 7.7, '', '', 'SAE', 3.00, 420),
  (11, 1, NOW() - INTERVAL '5 days'  + TIME '22:00', NOW() - INTERVAL '5 days'  + TIME '05:30', 1, 27.5, 29.0, 64, 91, 290, 400, 1, 240, 32, 7.7, '', '', 'SAE', 3.30, 450),
  (12, 1, NOW() - INTERVAL '3 days'  + TIME '13:00', NOW() - INTERVAL '3 days'  + TIME '13:30', 9, 12.0, 13.5, 44, 65, 205, 295, 3, 400, 155, 62, 'Tesla', 'Tesla', 'IEC', 4.80, 30),
  (13, 1, NOW() - INTERVAL '1 day'   + TIME '22:00', NOW() - INTERVAL '1 day'   + TIME '05:00', 1, 30.0, 31.5, 58, 92, 270, 410, 1, 240, 32, 7.7, '', '', 'SAE', 3.60, 420),

  -- Vehicle 2 (Model S) - mix of home + supercharger
  (14, 2, NOW() - INTERVAL '28 days' + TIME '14:00', NOW() - INTERVAL '28 days' + TIME '14:25', 8, 25.0, 26.5, 40, 60, 345, 520, 3, 400, 250, 250, 'Tesla', 'Tesla', 'IEC', 10.00, 25),
  (15, 2, NOW() - INTERVAL '27 days' + TIME '22:00', NOW() - INTERVAL '27 days' + TIME '06:00', 1, 52.0, 55.0, 10, 90, 85, 560, 1, 240, 48, 11.5, '', '', 'SAE', 6.24, 480),
  (16, 2, NOW() - INTERVAL '21 days' + TIME '22:00', NOW() - INTERVAL '21 days' + TIME '05:00', 1, 32.0, 34.0, 57, 87, 365, 540, 1, 240, 48, 11.5, '', '', 'SAE', 3.84, 420),
  (17, 2, NOW() - INTERVAL '14 days' + TIME '11:30', NOW() - INTERVAL '14 days' + TIME '12:00', 10, 22.0, 23.5, 58, 76, 385, 510, 3, 400, 250, 250, 'Tesla', 'Tesla', 'IEC', 8.80, 30),
  (18, 2, NOW() - INTERVAL '13 days' + TIME '22:00', NOW() - INTERVAL '13 days' + TIME '06:30', 1, 48.0, 50.5, 32, 88, 220, 555, 1, 240, 48, 11.5, '', '', 'SAE', 5.76, 510),
  (19, 2, NOW() - INTERVAL '7 days'  + TIME '22:00', NOW() - INTERVAL '7 days'  + TIME '04:30', 1, 28.0, 29.5, 63, 86, 420, 540, 1, 240, 48, 11.5, '', '', 'SAE', 3.36, 390),
  (20, 2, NOW() - INTERVAL '2 days'  + TIME '22:00', NOW() - INTERVAL '2 days'  + TIME '05:00', 1, 35.0, 37.0, 55, 89, 370, 555, 1, 240, 48, 11.5, '', '', 'SAE', 4.20, 420),

  -- Vehicle 3 (Model Y)
  (21, 3, NOW() - INTERVAL '25 days' + TIME '22:00', NOW() - INTERVAL '25 days' + TIME '05:00', 1, 25.5, 27.0, 69, 90, 337, 430, 1, 240, 32, 7.7, '', '', 'SAE', 3.06, 420),
  (22, 3, NOW() - INTERVAL '20 days' + TIME '22:00', NOW() - INTERVAL '20 days' + TIME '05:30', 1, 30.0, 31.5, 52, 88, 262, 420, 1, 240, 32, 7.7, '', '', 'SAE', 3.60, 450),
  (23, 3, NOW() - INTERVAL '15 days' + TIME '22:00', NOW() - INTERVAL '15 days' + TIME '04:45', 1, 22.0, 23.5, 72, 90, 348, 435, 1, 240, 32, 7.7, '', '', 'SAE', 2.64, 405),
  (24, 3, NOW() - INTERVAL '12 days' + TIME '22:00', NOW() - INTERVAL '12 days' + TIME '05:00', 1, 24.0, 25.5, 68, 89, 330, 430, 1, 240, 32, 7.7, '', '', 'SAE', 2.88, 420),
  (25, 3, NOW() - INTERVAL '8 days'  + TIME '11:00', NOW() - INTERVAL '8 days'  + TIME '11:30', 8, 28.0, 30.0, 42, 72, 175, 345, 3, 400, 175, 70, 'Tesla', 'Tesla', 'IEC', 11.20, 30),
  (26, 3, NOW() - INTERVAL '7 days'  + TIME '22:00', NOW() - INTERVAL '7 days'  + TIME '07:00', 1, 42.0, 44.5, 0,  88, 0,   430, 1, 240, 32, 7.7, '', '', 'SAE', 5.04, 540),
  (27, 3, NOW() - INTERVAL '4 days'  + TIME '22:00', NOW() - INTERVAL '4 days'  + TIME '05:15', 1, 24.5, 26.0, 70, 90, 340, 435, 1, 240, 32, 7.7, '', '', 'SAE', 2.94, 435),
  (28, 3, NOW() - INTERVAL '1 day'   + TIME '22:00', NOW() - INTERVAL '1 day'   + TIME '04:30', 1, 22.0, 23.5, 72, 90, 350, 440, 1, 240, 32, 7.7, '', '', 'SAE', 2.64, 390)
ON CONFLICT (id) DO NOTHING;

SELECT setval('charging_sessions_id_seq', (SELECT MAX(id) FROM charging_sessions));

-- ============================================================
-- 5. POSITIONS (GPS breadcrumbs - recent data for map)
--    Route: San Francisco → Mountain View commute (101 S corridor)
-- ============================================================
INSERT INTO positions (vehicle_id, latitude, longitude, speed, power, heading, elevation, odometer,
                       ideal_range, rated_range, battery_level, inside_temp, outside_temp, fan_status, is_climate_on, created_at)
VALUES
  -- Vehicle 1: Most recent drive (yesterday morning commute SF→MV via 101)
  (1, 37.7749, -122.4194,   0, 0,   180, 16,  45230.0, 410, 373, 92, 21.2, 16.0, 3, true, NOW() - INTERVAL '1 day' + TIME '08:20'),
  (1, 37.7680, -122.4100,  45, 15,  170, 12,  45230.8, 409, 372, 92, 21.3, 16.0, 3, true, NOW() - INTERVAL '1 day' + TIME '08:22'),
  (1, 37.7550, -122.3950,  85, 25,  165, 8,   45232.5, 407, 370, 91, 21.5, 16.1, 3, true, NOW() - INTERVAL '1 day' + TIME '08:25'),
  (1, 37.7200, -122.3800, 110, 35,  160, 5,   45236.0, 404, 367, 91, 21.5, 16.2, 3, true, NOW() - INTERVAL '1 day' + TIME '08:28'),
  (1, 37.6900, -122.3600, 115, 38,  155, 8,   45240.2, 401, 364, 90, 21.6, 16.3, 2, true, NOW() - INTERVAL '1 day' + TIME '08:31'),
  (1, 37.6500, -122.3400, 120, 40,  150, 10,  45245.5, 398, 361, 90, 21.7, 16.5, 2, true, NOW() - INTERVAL '1 day' + TIME '08:34'),
  (1, 37.6100, -122.3100, 118, 38,  148, 12,  45250.0, 395, 358, 89, 21.8, 16.5, 2, true, NOW() - INTERVAL '1 day' + TIME '08:37'),
  (1, 37.5700, -122.2700, 122, 42,  145, 15,  45255.5, 392, 355, 88, 22.0, 16.8, 2, true, NOW() - INTERVAL '1 day' + TIME '08:40'),
  (1, 37.5300, -122.2400, 115, 35,  142, 18,  45260.0, 389, 352, 87, 22.0, 16.8, 2, true, NOW() - INTERVAL '1 day' + TIME '08:43'),
  (1, 37.4900, -122.2000, 108, 30,  140, 22,  45264.5, 387, 350, 86, 22.0, 17.0, 2, true, NOW() - INTERVAL '1 day' + TIME '08:46'),
  (1, 37.4500, -122.1500,  85, 20,  138, 25,  45268.0, 385, 348, 85, 22.0, 17.0, 2, true, NOW() - INTERVAL '1 day' + TIME '08:49'),
  (1, 37.4200, -122.1100,  55, 10,  135, 28,  45278.0, 378, 343, 84, 22.0, 17.0, 2, true, NOW() - INTERVAL '1 day' + TIME '08:52'),
  (1, 37.3861, -122.0839,   0, 0,   130, 30,  45282.0, 375, 340, 83, 22.0, 17.0, 0, false, NOW() - INTERVAL '1 day' + TIME '08:55'),

  -- Vehicle 1: parked at office currently (latest position)
  (1, 37.3861, -122.0839,  0,  0,  130, 30, 45282.0, 410, 373, 92, 20.0, 16.5, 0, false, NOW() - INTERVAL '2 hours'),

  -- Vehicle 2: parked at home (latest)
  (2, 37.7749, -122.4194,  0,  0,  0,   16, 68450.0, 555, 540, 89, 19.0, 14.5, 0, false, NOW() - INTERVAL '6 hours'),

  -- Vehicle 3: recent drive positions + parked at office (latest)
  (3, 37.7749, -122.4194,   0, 0,   180, 16, 32150.0, 448, 410, 94, 21.0, 16.0, 3, true, NOW() - INTERVAL '1 day' + TIME '09:00'),
  (3, 37.7500, -122.4000,  75, 18,  165, 10, 32152.0, 446, 408, 93, 21.2, 16.0, 3, true, NOW() - INTERVAL '1 day' + TIME '09:03'),
  (3, 37.7100, -122.3700, 105, 30,  158, 6,  32155.5, 443, 405, 93, 21.5, 16.2, 2, true, NOW() - INTERVAL '1 day' + TIME '09:07'),
  (3, 37.6500, -122.3300, 118, 38,  150, 10, 32161.0, 439, 401, 92, 21.8, 16.5, 2, true, NOW() - INTERVAL '1 day' + TIME '09:12'),
  (3, 37.5800, -122.2800, 120, 40,  145, 14, 32168.0, 434, 396, 91, 22.0, 16.8, 2, true, NOW() - INTERVAL '1 day' + TIME '09:18'),
  (3, 37.5100, -122.2200, 115, 35,  142, 20, 32174.0, 430, 392, 90, 22.0, 17.0, 2, true, NOW() - INTERVAL '1 day' + TIME '09:24'),
  (3, 37.4400, -122.1400,  80, 18,  138, 26, 32180.0, 425, 388, 89, 22.0, 17.0, 2, true, NOW() - INTERVAL '1 day' + TIME '09:30'),
  (3, 37.3861, -122.0839,   0, 0,   130, 30, 32184.5, 422, 385, 85, 22.0, 17.0, 0, false, NOW() - INTERVAL '1 day' + TIME '09:35'),

  -- Vehicle 3: latest position (at office)
  (3, 37.3861, -122.0839,  0,  0,  130, 30, 32184.5, 448, 410, 90, 20.0, 16.5, 0, false, NOW() - INTERVAL '1 hour');

-- ============================================================
-- 6. GEOFENCES
-- ============================================================
INSERT INTO geofences (id, name, latitude, longitude, radius, cost_per_kwh, created_at, updated_at)
VALUES
  (1, 'Home',             37.7749, -122.4194, 100, 0.12,  NOW() - INTERVAL '12 months', NOW()),
  (2, 'Office',           37.3861, -122.0839, 150, 0.15,  NOW() - INTERVAL '12 months', NOW()),
  (3, 'Tesla Fremont',    37.4925, -121.9446, 200, NULL,   NOW() - INTERVAL '6 months',  NOW()),
  (4, 'Napa Valley',      38.2975, -122.2869, 500, 0.18,  NOW() - INTERVAL '3 months',  NOW()),
  (5, 'SF Supercharger',  37.7577, -122.3887, 50,  0.28,  NOW() - INTERVAL '2 months',  NOW())
ON CONFLICT (id) DO NOTHING;

SELECT setval('geofences_id_seq', (SELECT MAX(id) FROM geofences));

-- Seed geofence electricity rate history for temporal tracking
INSERT INTO geofence_electricity_rates (geofence_id, cost_per_kwh, effective_from, effective_to)
VALUES
  (1, 0.10, NOW() - INTERVAL '12 months', NOW() - INTERVAL '3 months'),
  (1, 0.12, NOW() - INTERVAL '3 months', NULL),
  (2, 0.15, NOW() - INTERVAL '12 months', NULL),
  (4, 0.16, NOW() - INTERVAL '3 months', NOW() - INTERVAL '1 month'),
  (4, 0.18, NOW() - INTERVAL '1 month', NULL),
  (5, 0.25, NOW() - INTERVAL '2 months', NOW() - INTERVAL '15 days'),
  (5, 0.28, NOW() - INTERVAL '15 days', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. SOFTWARE UPDATES
-- ============================================================
INSERT INTO software_updates (id, vehicle_id, version, status, scheduled_at, installed_at, created_at)
VALUES
  (1,  1, '2025.38.6',  'installed', NOW() - INTERVAL '90 days',  NOW() - INTERVAL '89 days', NOW() - INTERVAL '90 days'),
  (2,  1, '2025.44.2',  'installed', NOW() - INTERVAL '60 days',  NOW() - INTERVAL '59 days', NOW() - INTERVAL '60 days'),
  (3,  1, '2026.2.7',   'installed', NOW() - INTERVAL '30 days',  NOW() - INTERVAL '29 days', NOW() - INTERVAL '30 days'),
  (4,  1, '2026.8.1',   'installed', NOW() - INTERVAL '7 days',   NOW() - INTERVAL '6 days',  NOW() - INTERVAL '7 days'),
  (5,  2, '2025.38.6',  'installed', NOW() - INTERVAL '85 days',  NOW() - INTERVAL '84 days', NOW() - INTERVAL '85 days'),
  (6,  2, '2025.44.2',  'installed', NOW() - INTERVAL '55 days',  NOW() - INTERVAL '54 days', NOW() - INTERVAL '55 days'),
  (7,  2, '2026.2.7',   'installed', NOW() - INTERVAL '25 days',  NOW() - INTERVAL '24 days', NOW() - INTERVAL '25 days'),
  (8,  3, '2025.44.2',  'installed', NOW() - INTERVAL '50 days',  NOW() - INTERVAL '49 days', NOW() - INTERVAL '50 days'),
  (9,  3, '2026.2.7',   'installed', NOW() - INTERVAL '20 days',  NOW() - INTERVAL '19 days', NOW() - INTERVAL '20 days'),
  (10, 3, '2026.10.3',  'available', NOW() + INTERVAL '2 days',   NULL,                        NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

SELECT setval('software_updates_id_seq', (SELECT MAX(id) FROM software_updates));

-- ============================================================
-- 8. ALERTS (recent activity)
-- ============================================================
INSERT INTO alerts (id, vehicle_id, type, severity, title, message, is_read, created_at)
VALUES
  (1,  1, 'low_battery',     'warning',  'Low Battery - Midnight Runner', 'Battery dropped to 15% after Big Sur trip. Consider charging soon.', true,  NOW() - INTERVAL '14 days' + TIME '17:15'),
  (2,  1, 'battery_full',    'info',     'Charging Complete',              'Midnight Runner fully charged to 90% at Home.',                     true,  NOW() - INTERVAL '14 days' + TIME '06:00'),
  (3,  2, 'software_update', 'info',     'Software Update Available',      'Version 2026.2.7 is now available for Shadow.',                     true,  NOW() - INTERVAL '25 days'),
  (4,  2, 'speed',           'warning',  'Speed Alert - Shadow',           'Shadow reached 165 km/h on Highway 101. Speed limit is 120 km/h.', true,  NOW() - INTERVAL '14 days' + TIME '09:30'),
  (5,  3, 'geofence',        'info',     'Geofence Exit - Ghost',          'Ghost left the Home geofence.',                                     true,  NOW() - INTERVAL '8 days'  + TIME '07:00'),
  (6,  3, 'geofence',        'info',     'Geofence Enter - Ghost',         'Ghost entered the Office geofence.',                                true,  NOW() - INTERVAL '8 days'  + TIME '10:20'),
  (7,  1, 'sentry_mode',     'warning',  'Sentry Mode Event',              'Motion detected near Midnight Runner at Office parking.',            false, NOW() - INTERVAL '5 days'  + TIME '14:22'),
  (8,  3, 'software_update', 'info',     'Software Update Available',      'Version 2026.10.3 is available for Ghost. Scheduled for install.',   false, NOW() - INTERVAL '1 day'),
  (9,  1, 'battery_full',    'info',     'Charging Complete',              'Midnight Runner charged to 92% at Home.',                           false, NOW() - INTERVAL '1 day'   + TIME '05:00'),
  (10, 2, 'low_battery',     'critical', 'Very Low Battery - Shadow',      'Shadow battery at 10% after Yosemite return trip. Charge immediately.', false, NOW() - INTERVAL '27 days' + TIME '14:20'),
  (11, 1, 'speed',           'warning',  'Speed Alert - Midnight Runner',  'Midnight Runner reached 155 km/h on Highway 1 near Big Sur.',       false, NOW() - INTERVAL '15 days' + TIME '08:30'),
  (12, 3, 'sentry_mode',     'warning',  'Sentry Mode Event',              'Sentry mode activated on Ghost — someone approached the vehicle.',   false, NOW() - INTERVAL '3 days'  + TIME '23:45')
ON CONFLICT (id) DO NOTHING;

SELECT setval('alerts_id_seq', (SELECT MAX(id) FROM alerts));

-- ============================================================
-- 9. COMMAND LOGS
-- ============================================================
INSERT INTO command_logs (id, vehicle_id, command, params, status, error, created_at)
VALUES
  (1,  1, 'wake_up',          '',                  'success', '', NOW() - INTERVAL '10 days' + TIME '08:00'),
  (2,  1, 'lock',             '',                  'success', '', NOW() - INTERVAL '10 days' + TIME '09:05'),
  (3,  1, 'climate_on',       '{"temp": 21}',      'success', '', NOW() - INTERVAL '10 days' + TIME '07:50'),
  (4,  1, 'honk',             '',                  'success', '', NOW() - INTERVAL '8 days'  + TIME '18:00'),
  (5,  2, 'wake_up',          '',                  'success', '', NOW() - INTERVAL '7 days'  + TIME '10:30'),
  (6,  2, 'flash_lights',     '',                  'success', '', NOW() - INTERVAL '7 days'  + TIME '10:31'),
  (7,  2, 'set_charge_limit', '{"percent": 90}',   'success', '', NOW() - INTERVAL '7 days'  + TIME '22:00'),
  (8,  3, 'wake_up',          '',                  'success', '', NOW() - INTERVAL '4 days'  + TIME '08:00'),
  (9,  3, 'climate_on',       '{"temp": 22}',      'success', '', NOW() - INTERVAL '4 days'  + TIME '07:45'),
  (10, 3, 'unlock',           '',                  'success', '', NOW() - INTERVAL '4 days'  + TIME '08:10'),
  (11, 1, 'sentry_on',        '',                  'success', '', NOW() - INTERVAL '2 days'  + TIME '09:00'),
  (12, 1, 'open_trunk',       '',                  'failed',  'Vehicle not reachable', NOW() - INTERVAL '1 day' + TIME '12:30'),
  (13, 1, 'wake_up',          '',                  'success', '', NOW() - INTERVAL '1 day'  + TIME '12:31'),
  (14, 1, 'open_trunk',       '',                  'success', '', NOW() - INTERVAL '1 day'  + TIME '12:32')
ON CONFLICT (id) DO NOTHING;

SELECT setval('command_logs_id_seq', (SELECT MAX(id) FROM command_logs));

-- ============================================================
-- 10. BATTERY SNAPSHOTS (monthly health tracking)
-- ============================================================
INSERT INTO battery_snapshots (id, vehicle_id, health_score, capacity_kwh, degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
VALUES
  -- Vehicle 1 (Model 3 - 14 months old, ~82 kWh battery)
  (1,  1, 99.2, 81.3, 0.8, 485, 42,  24.5, NOW() - INTERVAL '12 months'),
  (2,  1, 98.8, 81.0, 1.2, 481, 78,  25.0, NOW() - INTERVAL '10 months'),
  (3,  1, 98.5, 80.8, 1.5, 478, 115, 25.2, NOW() - INTERVAL '8 months'),
  (4,  1, 98.1, 80.5, 1.9, 474, 152, 24.8, NOW() - INTERVAL '6 months'),
  (5,  1, 97.8, 80.2, 2.2, 470, 188, 25.5, NOW() - INTERVAL '4 months'),
  (6,  1, 97.5, 80.0, 2.5, 467, 225, 25.0, NOW() - INTERVAL '2 months'),
  (7,  1, 97.2, 79.7, 2.8, 464, 258, 24.8, NOW() - INTERVAL '1 month'),
  (8,  1, 97.0, 79.5, 3.0, 462, 275, 25.2, NOW() - INTERVAL '3 days'),

  -- Vehicle 2 (Model S Plaid - 10 months, ~100 kWh battery)
  (9,  2, 99.0, 99.0, 1.0, 610, 55,  26.0, NOW() - INTERVAL '9 months'),
  (10, 2, 98.5, 98.5, 1.5, 605, 95,  26.5, NOW() - INTERVAL '7 months'),
  (11, 2, 98.0, 98.0, 2.0, 600, 135, 26.2, NOW() - INTERVAL '5 months'),
  (12, 2, 97.6, 97.6, 2.4, 596, 170, 26.8, NOW() - INTERVAL '3 months'),
  (13, 2, 97.2, 97.2, 2.8, 591, 205, 26.0, NOW() - INTERVAL '1 month'),
  (14, 2, 97.0, 97.0, 3.0, 588, 225, 26.5, NOW() - INTERVAL '5 days'),

  -- Vehicle 3 (Model Y - 6 months, ~75 kWh battery)
  (15, 3, 99.5, 74.6, 0.5, 470, 28,  24.0, NOW() - INTERVAL '5 months'),
  (16, 3, 99.2, 74.4, 0.8, 468, 52,  24.5, NOW() - INTERVAL '3 months'),
  (17, 3, 99.0, 74.3, 1.0, 466, 78,  24.2, NOW() - INTERVAL '1 month'),
  (18, 3, 98.8, 74.1, 1.2, 464, 95,  24.8, NOW() - INTERVAL '4 days')
ON CONFLICT (id) DO NOTHING;

SELECT setval('battery_snapshots_id_seq', (SELECT MAX(id) FROM battery_snapshots));

COMMIT;
