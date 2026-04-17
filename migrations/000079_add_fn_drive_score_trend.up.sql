CREATE OR REPLACE FUNCTION fn_drive_score_trend(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, score INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT d.start_date,
    LEAST(100, ROUND(100.0 * d.distance
      / (d.start_rated_range_km - d.end_rated_range_km))::integer)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 0
    AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date;
END;
$$ LANGUAGE plpgsql STABLE;
