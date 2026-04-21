CREATE OR REPLACE FUNCTION fn_battery_cell_readings(p_vehicle_id BIGINT)
RETURNS TABLE (cell_id INTEGER, voltage NUMERIC, temp NUMERIC, v_deviation NUMERIC, t_deviation NUMERIC) AS $$
BEGIN
  -- No battery_cells table; return empty result set
  RETURN QUERY
  SELECT NULL::integer, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric
  WHERE false;
END;
$$ LANGUAGE plpgsql STABLE;
