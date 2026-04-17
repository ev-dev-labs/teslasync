CREATE OR REPLACE FUNCTION fn_battery_degradation_rate(p_vehicle_id BIGINT)
RETURNS TABLE (degradation_pct_yr NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND(
    (MAX(bs.health_score) - MIN(bs.health_score)) /
    NULLIF(EXTRACT(EPOCH FROM MAX(bs.created_at) - MIN(bs.created_at)) / (365.25 * 86400), 0)
  , 2)
  FROM battery_snapshots bs
  WHERE bs.vehicle_id = p_vehicle_id AND bs.health_score IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;
