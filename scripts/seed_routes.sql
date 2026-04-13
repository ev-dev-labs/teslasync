BEGIN;

-- ADDRESSES: 20 common locations
INSERT INTO addresses (display_name, latitude, longitude, name, road, city, state, country, postcode)
VALUES
  ('Home', 40.7128, -74.0060, 'Home', '123 Main St', 'New York', 'NY', 'US', '10001'),
  ('Work Office', 40.7580, -73.9855, 'Work', '456 Broadway', 'New York', 'NY', 'US', '10036'),
  ('Supercharger - Newark', 40.7357, -74.1724, 'Tesla Supercharger', 'Frelinghuysen Ave', 'Newark', 'NJ', 'US', '07114'),
  ('Supercharger - Paramus', 40.9568, -74.0702, 'Tesla Supercharger', 'Route 17', 'Paramus', 'NJ', 'US', '07652'),
  ('Grocery Store', 40.7282, -73.9942, 'Whole Foods', '95 E Houston St', 'New York', 'NY', 'US', '10002'),
  ('Gym', 40.7484, -73.9967, 'Equinox', '315 W 33rd St', 'New York', 'NY', 'US', '10001'),
  ('Mall', 40.7505, -73.9934, 'Hudson Yards', '20 Hudson Yards', 'New York', 'NY', 'US', '10001'),
  ('Airport - JFK', 40.6413, -73.7781, 'JFK Airport', 'JFK Access Rd', 'Queens', 'NY', 'US', '11430'),
  ('Airport - EWR', 40.6895, -74.1745, 'Newark Airport', 'Airport Rd', 'Newark', 'NJ', 'US', '07114'),
  ('Beach', 40.5731, -73.9712, 'Coney Island Beach', 'Surf Ave', 'Brooklyn', 'NY', 'US', '11224'),
  ('Restaurant', 40.7261, -73.9897, 'Carbone', 'Thompson St', 'New York', 'NY', 'US', '10012'),
  ('Hospital', 40.7900, -73.9526, 'Mount Sinai', 'Madison Ave', 'New York', 'NY', 'US', '10029'),
  ('School', 40.7295, -73.9965, 'NYU', 'Washington Sq', 'New York', 'NY', 'US', '10003'),
  ('Park', 40.7829, -73.9654, 'Central Park', 'Central Park W', 'New York', 'NY', 'US', '10024'),
  ('Costco', 40.8289, -74.1114, 'Costco', 'Wall St', 'North Bergen', 'NJ', 'US', '07047'),
  ('IKEA', 40.6727, -74.0100, 'IKEA', 'Beard St', 'Brooklyn', 'NY', 'US', '11231'),
  ('Destination Charger', 40.7614, -73.9776, 'Hotel Charger', 'Park Ave', 'New York', 'NY', 'US', '10022'),
  ('Friends House', 40.6892, -73.9857, 'Friends', 'Court St', 'Brooklyn', 'NY', 'US', '11201'),
  ('Doctors Office', 40.7527, -73.9772, 'Dr Smith', 'Lexington Ave', 'New York', 'NY', 'US', '10017'),
  ('Service Center', 40.7608, -73.8300, 'Tesla Service', 'Northern Blvd', 'Queens', 'NY', 'US', '11101');

-- Link drives to addresses
WITH addr_ids AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM addresses
)
UPDATE drives d SET
  start_address_id = (SELECT id FROM addr_ids WHERE rn = 1 + ((d.id - 1) % 20)),
  end_address_id = (SELECT id FROM addr_ids WHERE rn = 1 + (d.id % 20));

-- POSITIONS: ~10 GPS points per drive for last 500 drives
INSERT INTO positions (vehicle_id, latitude, longitude, speed, power, heading,
  elevation, odometer, battery_level, inside_temp, outside_temp, created_at)
SELECT
  1,
  40.71 + 0.05 * sin(d.id * 0.1 + step * 0.3) + 0.02 * random(),
  -74.01 + 0.08 * cos(d.id * 0.07 + step * 0.25) + 0.02 * random(),
  CASE WHEN step = 0 OR step = 9 THEN 0 ELSE 20 + random() * 80 END,
  CASE WHEN step = 0 OR step = 9 THEN 0 ELSE -20 + random() * 180 END,
  floor(random() * 360)::int,
  10 + random() * 50,
  COALESCE(d.start_odometer, 10000) + (d.distance * step / 9.0),
  COALESCE(d.start_battery_level, 80) - floor(step * COALESCE(d.start_battery_level - d.end_battery_level, 5)::float / 9)::int,
  20 + random() * 4,
  COALESCE(d.outside_temp_avg, 15),
  d.start_date + (d.duration_min * step / 9.0 || ' minutes')::interval
FROM drives d
CROSS JOIN generate_series(0, 9) AS step
WHERE d.id >= (SELECT MAX(id) - 499 FROM drives)
ORDER BY d.id, step;

-- DRIVE TELEMETRY: ~8 readings per drive for last 500 drives
INSERT INTO drive_telemetry_readings (drive_id, vehicle_id,
  latitude, longitude, elevation, heading, odometer,
  speed, power, battery_level, soc,
  rated_range, ideal_range, est_range,
  inside_temp, outside_temp, created_at)
SELECT
  d.id, 1,
  40.71 + 0.05 * sin(d.id * 0.1 + step * 0.4) + 0.02 * random(),
  -74.01 + 0.08 * cos(d.id * 0.07 + step * 0.3) + 0.02 * random(),
  10 + random() * 50,
  floor(random() * 360)::int,
  COALESCE(d.start_odometer, 10000) + (d.distance * step / 7.0),
  CASE WHEN step = 0 OR step = 7 THEN 0 ELSE 15 + random() * COALESCE(d.speed_max, 60) END,
  CASE WHEN step = 0 OR step = 7 THEN 0 ELSE -30 + random() * COALESCE(d.power_max, 100) END,
  GREATEST(5, COALESCE(d.start_battery_level, 80) - floor(step * GREATEST(COALESCE(d.start_battery_level - d.end_battery_level, 5), 1)::float / 7)::int),
  GREATEST(5, COALESCE(d.start_battery_level, 80) - floor(step * GREATEST(COALESCE(d.start_battery_level - d.end_battery_level, 5), 1)::float / 7))::float,
  GREATEST(5, COALESCE(d.start_battery_level, 80) - floor(step * GREATEST(COALESCE(d.start_battery_level - d.end_battery_level, 5), 1)::float / 7)) * 3.5,
  GREATEST(5, COALESCE(d.start_battery_level, 80) - floor(step * GREATEST(COALESCE(d.start_battery_level - d.end_battery_level, 5), 1)::float / 7)) * 3.8,
  GREATEST(5, COALESCE(d.start_battery_level, 80) - floor(step * GREATEST(COALESCE(d.start_battery_level - d.end_battery_level, 5), 1)::float / 7)) * 3.2,
  20 + random() * 4,
  COALESCE(d.outside_temp_avg, 15),
  d.start_date + (d.duration_min * step / 7.0 || ' minutes')::interval
FROM drives d
CROSS JOIN generate_series(0, 7) AS step
WHERE d.id >= (SELECT MAX(id) - 499 FROM drives)
ORDER BY d.id, step;

COMMIT;

SELECT 'positions' AS tbl, COUNT(*) FROM positions
UNION ALL SELECT 'drive_telemetry' AS tbl, COUNT(*) FROM drive_telemetry_readings
UNION ALL SELECT 'addresses' AS tbl, COUNT(*) FROM addresses
ORDER BY 1;
