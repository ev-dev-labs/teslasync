CREATE OR REPLACE FUNCTION fn_anomaly_severity_distribution(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (severity TEXT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT a.severity::text, COUNT(*)::bigint
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  GROUP BY a.severity
  ORDER BY CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 ELSE 4 END;
END;
$$ LANGUAGE plpgsql STABLE;
