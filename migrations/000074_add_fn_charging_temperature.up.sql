CREATE OR REPLACE FUNCTION fn_charging_temperature(p_session_id BIGINT)
RETURNS TABLE ("time" TIMESTAMPTZ, battery_temp DOUBLE PRECISION, outside_temp DOUBLE PRECISION) AS $$
BEGIN
  RETURN QUERY
  SELECT ct.created_at, ct.battery_temp, ct.outside_temp
  FROM charge_telemetry_readings ct
  WHERE ct.session_id = p_session_id
  ORDER BY ct.created_at;
END;
$$ LANGUAGE plpgsql STABLE;
