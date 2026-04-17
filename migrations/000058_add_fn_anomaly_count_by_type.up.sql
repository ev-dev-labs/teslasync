CREATE OR REPLACE FUNCTION fn_anomaly_count_by_type(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (category TEXT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT a.type::text, COUNT(*)::bigint
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  GROUP BY a.type
  ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql STABLE;
