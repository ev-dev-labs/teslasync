CREATE OR REPLACE FUNCTION fn_charging_calendar_heatmap(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, sessions BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT DATE_TRUNC('day', cs.start_date), COUNT(*)::bigint
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR cs.start_date >= p_from)
    AND (p_to IS NULL OR cs.start_date <= p_to)
  GROUP BY DATE_TRUNC('day', cs.start_date)
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE;
