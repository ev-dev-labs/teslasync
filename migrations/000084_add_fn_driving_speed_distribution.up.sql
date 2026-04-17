CREATE OR REPLACE FUNCTION fn_driving_speed_distribution(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (speed_range TEXT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (FLOOR(d.speed_avg / 10) * 10 || '-' || (FLOOR(d.speed_avg / 10) * 10 + 10))::text,
    COUNT(*)::bigint
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.speed_avg > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY FLOOR(d.speed_avg / 10)
  ORDER BY FLOOR(d.speed_avg / 10);
END;
$$ LANGUAGE plpgsql STABLE;
