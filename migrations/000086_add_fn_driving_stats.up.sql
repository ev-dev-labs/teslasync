CREATE OR REPLACE FUNCTION fn_driving_stats(
  p_vehicle_id BIGINT,
  p_period TEXT DEFAULT 'today'  -- 'today', 'week', 'month', 'all'
)
RETURNS TABLE (
  distance NUMERIC,
  drives BIGINT,
  energy_kwh NUMERIC,
  drive_min NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(COALESCE(SUM(d.distance), 0)::numeric, 1),
    COUNT(*)::bigint,
    ROUND(COALESCE(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)), 0)::numeric, 1),
    ROUND(COALESCE(SUM(d.duration_min), 0)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_period = 'all' OR d.start_date >= CASE p_period
      WHEN 'today' THEN DATE_TRUNC('day', NOW())
      WHEN 'week' THEN DATE_TRUNC('week', NOW())
      WHEN 'month' THEN DATE_TRUNC('month', NOW())
    END);
END;
$$ LANGUAGE plpgsql STABLE;
