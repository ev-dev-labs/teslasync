CREATE OR REPLACE FUNCTION fn_anomaly_timeline(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, severity TEXT, signal TEXT, type TEXT, z_score DOUBLE PRECISION) AS $$
BEGIN
  RETURN QUERY
  SELECT a.detected_at, a.severity::text, a.signal_name::text, a.anomaly_type::text, a.z_score
  FROM anomalies a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.detected_at >= p_from)
    AND (p_to IS NULL OR a.detected_at <= p_to)
  ORDER BY a.detected_at;
END;
$$ LANGUAGE plpgsql STABLE;
