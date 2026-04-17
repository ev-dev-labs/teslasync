CREATE OR REPLACE FUNCTION fn_charging_power_timeline(p_session_id BIGINT)
RETURNS TABLE ("time" TIMESTAMPTZ, power_kw DOUBLE PRECISION, soc DOUBLE PRECISION) AS $$
BEGIN
  RETURN QUERY
  SELECT ct.created_at, ct.charge_rate_kw, ct.battery_level
  FROM charging_telemetry_readings ct
  WHERE ct.session_id = p_session_id
  ORDER BY ct.created_at;
END;
$$ LANGUAGE plpgsql STABLE;
