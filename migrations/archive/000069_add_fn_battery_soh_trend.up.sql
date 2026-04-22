CREATE OR REPLACE FUNCTION fn_battery_soh_trend(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, soh_pct DOUBLE PRECISION) AS $$
BEGIN
  RETURN QUERY
  SELECT bs.created_at, bs.health_score
  FROM battery_snapshots bs
  WHERE bs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR bs.created_at >= p_from)
    AND (p_to IS NULL OR bs.created_at <= p_to)
  ORDER BY bs.created_at;
END;
$$ LANGUAGE plpgsql STABLE;
