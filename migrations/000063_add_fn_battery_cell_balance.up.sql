CREATE OR REPLACE FUNCTION fn_battery_cell_balance(p_vehicle_id BIGINT)
RETURNS TABLE (voltage_delta NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND((COALESCE(vls.brick_voltage_max, 0) - COALESCE(vls.brick_voltage_min, 0))::numeric, 4)
  FROM vehicle_live_state vls
  WHERE vls.vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql STABLE;
