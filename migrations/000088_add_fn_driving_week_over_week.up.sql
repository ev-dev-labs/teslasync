CREATE OR REPLACE FUNCTION fn_driving_week_over_week(p_vehicle_id BIGINT)
RETURNS TABLE (period TEXT, km NUMERIC, drives BIGINT, kwh NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH this_week AS (
    SELECT 'This Week'::text AS p,
      COALESCE(SUM(distance), 0) AS km, COUNT(*)::bigint AS drives,
      COALESCE(SUM(energy_used_kwh), 0) AS kwh
    FROM drives WHERE vehicle_id = p_vehicle_id AND start_date >= DATE_TRUNC('week', NOW())
  ),
  last_week AS (
    SELECT 'Last Week'::text,
      COALESCE(SUM(distance), 0), COUNT(*)::bigint,
      COALESCE(SUM(energy_used_kwh), 0)
    FROM drives WHERE vehicle_id = p_vehicle_id
      AND start_date >= DATE_TRUNC('week', NOW()) - INTERVAL '7 days'
      AND start_date < DATE_TRUNC('week', NOW())
  )
  SELECT * FROM this_week UNION ALL SELECT * FROM last_week;
END;
$$ LANGUAGE plpgsql STABLE;
