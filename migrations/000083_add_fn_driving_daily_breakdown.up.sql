CREATE OR REPLACE FUNCTION fn_driving_daily_breakdown(p_vehicle_id BIGINT)
RETURNS TABLE ("time" TIMESTAMPTZ, distance NUMERIC, energy_kwh NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('day', d.start_date),
    ROUND(SUM(d.distance)::numeric, 1),
    ROUND(SUM(d.energy_used_kwh)::numeric, 1)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.start_date >= DATE_TRUNC('week', NOW())
  GROUP BY DATE_TRUNC('day', d.start_date)
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE;
