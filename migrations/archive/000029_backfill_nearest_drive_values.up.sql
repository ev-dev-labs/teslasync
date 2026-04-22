-- Backfill drives with zero/null start/end values using nearest position data.
-- Uses a ±10 minute window around drive start/end times to find the closest
-- position with non-zero values. This handles Fleet Telemetry's sparse signal
-- delivery (e.g., SOC every ~5 min, odometer sporadically).

-- 1. Backfill start SOC/battery from nearest position to drive start
UPDATE drives d
SET start_battery_level = COALESCE(NULLIF(d.start_battery_level, 0), sub.nearest_battery),
    soc_start = COALESCE(NULLIF(d.soc_start, 0), sub.nearest_soc)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.battery_level FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.start_date - INTERVAL '10 minutes' AND d2.start_date + INTERVAL '10 minutes'
       AND p.battery_level > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.start_date)))
     LIMIT 1) AS nearest_battery,
    (SELECT p.battery_level::float FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.start_date - INTERVAL '10 minutes' AND d2.start_date + INTERVAL '10 minutes'
       AND p.battery_level > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.start_date)))
     LIMIT 1) AS nearest_soc
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.start_battery_level IS NULL OR d2.start_battery_level = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_battery IS NOT NULL;

-- 2. Backfill end SOC/battery from nearest position to drive end
UPDATE drives d
SET end_battery_level = COALESCE(NULLIF(d.end_battery_level, 0), sub.nearest_battery),
    soc_end = COALESCE(NULLIF(d.soc_end, 0), sub.nearest_soc)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.battery_level FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.end_date - INTERVAL '10 minutes' AND d2.end_date + INTERVAL '10 minutes'
       AND p.battery_level > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.end_date)))
     LIMIT 1) AS nearest_battery,
    (SELECT p.battery_level::float FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.end_date - INTERVAL '10 minutes' AND d2.end_date + INTERVAL '10 minutes'
       AND p.battery_level > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.end_date)))
     LIMIT 1) AS nearest_soc
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.end_battery_level IS NULL OR d2.end_battery_level = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_battery IS NOT NULL;

-- 3. Backfill start/end odometer from nearest positions
UPDATE drives d
SET start_odometer = COALESCE(NULLIF(d.start_odometer, 0), sub.nearest_odo)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.odometer FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.start_date - INTERVAL '10 minutes' AND d2.start_date + INTERVAL '10 minutes'
       AND p.odometer > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.start_date)))
     LIMIT 1) AS nearest_odo
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.start_odometer IS NULL OR d2.start_odometer = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_odo IS NOT NULL;

UPDATE drives d
SET end_odometer = COALESCE(NULLIF(d.end_odometer, 0), sub.nearest_odo)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.odometer FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.end_date - INTERVAL '10 minutes' AND d2.end_date + INTERVAL '10 minutes'
       AND p.odometer > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.end_date)))
     LIMIT 1) AS nearest_odo
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.end_odometer IS NULL OR d2.end_odometer = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_odo IS NOT NULL;

-- 4. Recompute distance from backfilled odometer values
UPDATE drives
SET distance = GREATEST(end_odometer - start_odometer, 0)
WHERE end_date IS NOT NULL
  AND (distance IS NULL OR distance = 0)
  AND start_odometer IS NOT NULL AND start_odometer > 0
  AND end_odometer IS NOT NULL AND end_odometer > 0
  AND end_odometer > start_odometer;

-- 5. Backfill start/end rated range from nearest positions
UPDATE drives d
SET start_rated_range_km = COALESCE(NULLIF(d.start_rated_range_km, 0), sub.nearest_rr)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.rated_range FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.start_date - INTERVAL '10 minutes' AND d2.start_date + INTERVAL '10 minutes'
       AND p.rated_range IS NOT NULL AND p.rated_range > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.start_date)))
     LIMIT 1) AS nearest_rr
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.start_rated_range_km IS NULL OR d2.start_rated_range_km = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_rr IS NOT NULL;

UPDATE drives d
SET end_rated_range_km = COALESCE(NULLIF(d.end_rated_range_km, 0), sub.nearest_rr)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.rated_range FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.end_date - INTERVAL '10 minutes' AND d2.end_date + INTERVAL '10 minutes'
       AND p.rated_range IS NOT NULL AND p.rated_range > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.end_date)))
     LIMIT 1) AS nearest_rr
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.end_rated_range_km IS NULL OR d2.end_rated_range_km = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_rr IS NOT NULL;

-- 6. Backfill start/end ideal range from nearest positions
UPDATE drives d
SET start_ideal_range_km = COALESCE(NULLIF(d.start_ideal_range_km, 0), sub.nearest_ir)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.ideal_range FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.start_date - INTERVAL '10 minutes' AND d2.start_date + INTERVAL '10 minutes'
       AND p.ideal_range IS NOT NULL AND p.ideal_range > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.start_date)))
     LIMIT 1) AS nearest_ir
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.start_ideal_range_km IS NULL OR d2.start_ideal_range_km = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_ir IS NOT NULL;

UPDATE drives d
SET end_ideal_range_km = COALESCE(NULLIF(d.end_ideal_range_km, 0), sub.nearest_ir)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.ideal_range FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.end_date - INTERVAL '10 minutes' AND d2.end_date + INTERVAL '10 minutes'
       AND p.ideal_range IS NOT NULL AND p.ideal_range > 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.end_date)))
     LIMIT 1) AS nearest_ir
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND (d2.end_ideal_range_km IS NULL OR d2.end_ideal_range_km = 0)
) sub
WHERE d.id = sub.drive_id AND sub.nearest_ir IS NOT NULL;

-- 7. Backfill elevation start/end from nearest positions
UPDATE drives d
SET elevation_start = COALESCE(d.elevation_start, sub.nearest_elev)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.elevation FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.start_date - INTERVAL '10 minutes' AND d2.start_date + INTERVAL '10 minutes'
       AND p.elevation IS NOT NULL AND p.elevation != 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.start_date)))
     LIMIT 1) AS nearest_elev
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND d2.elevation_start IS NULL
) sub
WHERE d.id = sub.drive_id AND sub.nearest_elev IS NOT NULL;

UPDATE drives d
SET elevation_end = COALESCE(d.elevation_end, sub.nearest_elev)
FROM (
  SELECT d2.id AS drive_id,
    (SELECT p.elevation FROM positions p
     WHERE p.vehicle_id = d2.vehicle_id
       AND p.created_at BETWEEN d2.end_date - INTERVAL '10 minutes' AND d2.end_date + INTERVAL '10 minutes'
       AND p.elevation IS NOT NULL AND p.elevation != 0
     ORDER BY ABS(EXTRACT(EPOCH FROM (p.created_at - d2.end_date)))
     LIMIT 1) AS nearest_elev
  FROM drives d2
  WHERE d2.end_date IS NOT NULL
    AND d2.elevation_end IS NULL
) sub
WHERE d.id = sub.drive_id AND sub.nearest_elev IS NOT NULL;
