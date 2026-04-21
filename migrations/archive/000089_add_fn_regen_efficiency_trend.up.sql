CREATE OR REPLACE FUNCTION fn_regen_efficiency_trend(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, regen_pct NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.start_date,
    CASE WHEN (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
      THEN ROUND((ABS(LEAST(COALESCE(d.power_min, 0), 0)) / (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 100)::numeric, 1)
      ELSE NULL END
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.power_min IS NOT NULL
    AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date;
END;
$$ LANGUAGE plpgsql STABLE;
