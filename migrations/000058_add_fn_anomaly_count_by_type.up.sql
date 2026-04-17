CREATE OR REPLACE FUNCTION fn_anomaly_count_by_type(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (category TEXT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT COALESCE(a.signal_category, a.signal_name)::text, COUNT(*)::bigint
  FROM anomalies a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.detected_at >= p_from)
    AND (p_to IS NULL OR a.detected_at <= p_to)
  GROUP BY COALESCE(a.signal_category, a.signal_name)
  ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql STABLE;
