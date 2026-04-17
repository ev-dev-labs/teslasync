CREATE OR REPLACE FUNCTION fn_charging_rate_vs_soc(p_vehicle_id BIGINT, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (soc DOUBLE PRECISION, power_kw DOUBLE PRECISION, session_id BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT ct.battery_level, ct.charge_rate_kw, ct.session_id
  FROM charging_telemetry_readings ct
  WHERE ct.session_id IN (
    SELECT cs.id FROM charging_sessions cs
    WHERE cs.vehicle_id = p_vehicle_id
    ORDER BY cs.start_date DESC LIMIT p_limit
  )
  ORDER BY ct.battery_level;
END;
$$ LANGUAGE plpgsql STABLE;
