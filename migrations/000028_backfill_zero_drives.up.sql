-- Backfill completed drives that have distance=0 by computing from positions.
-- This fixes drives created by the API polling path before the accumulator fix.

-- 1. Backfill distance from odometer (start/end positions during drive window)
UPDATE drives d
SET distance = sub.calc_distance,
    duration_min = COALESCE(NULLIF(d.duration_min, 0), sub.calc_duration)
FROM (
  SELECT
    d2.id AS drive_id,
    GREATEST(MAX(p.odometer) - MIN(p.odometer), 0) AS calc_distance,
    EXTRACT(EPOCH FROM (d2.end_date - d2.start_date)) / 60.0 AS calc_duration
  FROM drives d2
  JOIN positions p ON p.vehicle_id = d2.vehicle_id
    AND p.created_at >= d2.start_date
    AND p.created_at <= d2.end_date
  WHERE d2.end_date IS NOT NULL
    AND d2.distance = 0
    AND d2.duration_min = 0
  GROUP BY d2.id, d2.start_date, d2.end_date
  HAVING MAX(p.odometer) - MIN(p.odometer) > 0
) sub
WHERE d.id = sub.drive_id;

-- 2. Backfill battery levels from first/last positions in the drive window
UPDATE drives d
SET start_battery_level = COALESCE(d.start_battery_level, sub.first_battery),
    end_battery_level   = COALESCE(d.end_battery_level, sub.last_battery)
FROM (
  SELECT DISTINCT ON (d2.id)
    d2.id AS drive_id,
    first_value(p.battery_level) OVER (PARTITION BY d2.id ORDER BY p.created_at ASC) AS first_battery,
    first_value(p.battery_level) OVER (PARTITION BY d2.id ORDER BY p.created_at DESC) AS last_battery
  FROM drives d2
  JOIN positions p ON p.vehicle_id = d2.vehicle_id
    AND p.created_at >= d2.start_date
    AND p.created_at <= d2.end_date
  WHERE d2.end_date IS NOT NULL
    AND (d2.start_battery_level IS NULL OR d2.end_battery_level IS NULL)
    AND p.battery_level > 0
) sub
WHERE d.id = sub.drive_id;

-- 3. Backfill speed_max from positions
UPDATE drives d
SET speed_max = sub.max_speed
FROM (
  SELECT d2.id AS drive_id, MAX(p.speed) AS max_speed
  FROM drives d2
  JOIN positions p ON p.vehicle_id = d2.vehicle_id
    AND p.created_at >= d2.start_date
    AND p.created_at <= d2.end_date
  WHERE d2.end_date IS NOT NULL
    AND d2.speed_max IS NULL
    AND p.speed IS NOT NULL
  GROUP BY d2.id
  HAVING MAX(p.speed) > 0
) sub
WHERE d.id = sub.drive_id;

-- 4. Backfill duration_min for drives that have end_date but zero duration
UPDATE drives
SET duration_min = EXTRACT(EPOCH FROM (end_date - start_date)) / 60.0
WHERE end_date IS NOT NULL
  AND duration_min = 0;

-- 5. Backfill start/end coordinates from first/last positions
UPDATE drives d
SET start_latitude = sub.first_lat,
    start_longitude = sub.first_lon,
    end_latitude = sub.last_lat,
    end_longitude = sub.last_lon
FROM (
  SELECT DISTINCT ON (d2.id)
    d2.id AS drive_id,
    first_value(p.latitude) OVER (PARTITION BY d2.id ORDER BY p.created_at ASC) AS first_lat,
    first_value(p.longitude) OVER (PARTITION BY d2.id ORDER BY p.created_at ASC) AS first_lon,
    first_value(p.latitude) OVER (PARTITION BY d2.id ORDER BY p.created_at DESC) AS last_lat,
    first_value(p.longitude) OVER (PARTITION BY d2.id ORDER BY p.created_at DESC) AS last_lon
  FROM drives d2
  JOIN positions p ON p.vehicle_id = d2.vehicle_id
    AND p.created_at >= d2.start_date
    AND p.created_at <= d2.end_date
  WHERE d2.end_date IS NOT NULL
    AND d2.start_latitude IS NULL
    AND p.latitude != 0 AND p.longitude != 0
) sub
WHERE d.id = sub.drive_id;
