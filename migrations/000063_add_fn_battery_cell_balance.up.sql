CREATE OR REPLACE FUNCTION fn_battery_cell_balance(p_vehicle_id BIGINT)
RETURNS TABLE (voltage_delta NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND((MAX(bc.voltage) - MIN(bc.voltage))::numeric, 4)
  FROM battery_cells bc
  WHERE bc.vehicle_id = p_vehicle_id
    AND bc.created_at = (SELECT MAX(created_at) FROM battery_cells WHERE vehicle_id = p_vehicle_id);
END;
$$ LANGUAGE plpgsql STABLE;
