CREATE OR REPLACE FUNCTION fn_driving_week_over_week(p_vehicle_id BIGINT)
RETURNS TABLE (period TEXT, km NUMERIC, drives BIGINT, kwh NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH this_week AS (
    SELECT 'This Week'::text AS p,
      COALESCE(SUM(distance), 0)::numeric AS km, COUNT(*)::bigint AS drives,
      COALESCE(SUM(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0)), 0)::numeric AS kwh
    FROM drives WHERE vehicle_id = p_vehicle_id AND start_date >= DATE_TRUNC('week', NOW())
  ),
  last_week AS (
    SELECT 'Last Week'::text,
      COALESCE(SUM(distance), 0)::numeric, COUNT(*)::bigint,
      COALESCE(SUM(COALESCE(start_rated_range_km, 0) - COALESCE(end_rated_range_km, 0)), 0)::numeric
    FROM drives WHERE vehicle_id = p_vehicle_id
      AND start_date >= DATE_TRUNC('week', NOW()) - INTERVAL '7 days'
      AND start_date < DATE_TRUNC('week', NOW())
  )
  SELECT * FROM this_week UNION ALL SELECT * FROM last_week;
END;
$$ LANGUAGE plpgsql STABLE;
