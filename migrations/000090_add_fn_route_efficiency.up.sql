CREATE OR REPLACE FUNCTION fn_route_efficiency(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (route TEXT, trips BIGINT, avg_wh_per_km NUMERIC, avg_distance NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (COALESCE(d.start_address, '?') || ' → ' || COALESCE(d.end_address, '?'))::text,
    COUNT(*)::bigint,
    ROUND(AVG(CASE WHEN d.distance > 0 THEN (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 1000 / d.distance END)::numeric, 0),
    ROUND(AVG(d.distance)::numeric, 1)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 1
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  GROUP BY d.start_address, d.end_address
  HAVING COUNT(*) >= 2
  ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql STABLE;
