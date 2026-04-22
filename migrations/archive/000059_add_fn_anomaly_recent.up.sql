CREATE OR REPLACE FUNCTION fn_anomaly_recent(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE ("time" TIMESTAMPTZ, signal TEXT, type TEXT, severity TEXT, z_score NUMERIC, description TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT a.created_at, a.title::text, a.type::text, a.severity::text,
    NULL::numeric, a.message::text
  FROM alerts a
  WHERE a.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
  ORDER BY a.created_at DESC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
