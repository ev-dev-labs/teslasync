CREATE OR REPLACE FUNCTION fn_weekly_summary(p_vehicle_id BIGINT)
RETURNS TABLE (distance NUMERIC, drives BIGINT, energy_kwh NUMERIC, drive_min NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(COALESCE(SUM(d.distance), 0)::numeric, 1),
    COUNT(*)::bigint,
    ROUND(COALESCE(SUM(COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)), 0)::numeric, 1),
    ROUND(COALESCE(SUM(d.duration_min), 0)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.start_date >= DATE_TRUNC('week', NOW());
END;
$$ LANGUAGE plpgsql STABLE;
