CREATE OR REPLACE FUNCTION fn_speed_profile_histogram(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (speed_band TEXT, reading_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (FLOOR(dt.speed / 10) * 10 || '-' || (FLOOR(dt.speed / 10) * 10 + 10))::text,
    COUNT(*)::bigint
  FROM drive_telemetry_readings dt
  JOIN drives d ON dt.drive_id = d.id
  WHERE d.vehicle_id = p_vehicle_id
    AND dt.speed > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY FLOOR(dt.speed / 10)
  ORDER BY FLOOR(dt.speed / 10);
END;
$$ LANGUAGE plpgsql STABLE;
