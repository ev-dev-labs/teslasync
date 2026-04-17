CREATE OR REPLACE FUNCTION fn_battery_capacity_over_time(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (time TIMESTAMPTZ, estimated_capacity NUMERIC, original_capacity NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT bs.created_at,
    bs.usable_battery_level::numeric,
    (bs.rated_range * 0.075)::numeric
  FROM battery_snapshots bs
  WHERE bs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR bs.created_at >= p_from)
    AND (p_to IS NULL OR bs.created_at <= p_to)
  ORDER BY bs.created_at;
END;
$$ LANGUAGE plpgsql STABLE;
