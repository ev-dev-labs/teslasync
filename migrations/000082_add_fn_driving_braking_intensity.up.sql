CREATE OR REPLACE FUNCTION fn_driving_braking_intensity(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, hard_brakes BIGINT, moderate_brakes BIGINT, avg_decel NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.start_date,
    COUNT(*) FILTER (WHERE dt.acceleration_gs < -0.3)::bigint,
    COUNT(*) FILTER (WHERE dt.acceleration_gs < -0.2 AND dt.acceleration_gs >= -0.3)::bigint,
    ROUND(AVG(dt.acceleration_gs) FILTER (WHERE dt.acceleration_gs < 0)::numeric, 3)
  FROM drive_telemetry_readings dt
  JOIN drives d ON dt.drive_id = d.id
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY d.id, d.start_date
  ORDER BY d.start_date;
END;
$$ LANGUAGE plpgsql STABLE;
