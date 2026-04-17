CREATE OR REPLACE FUNCTION fn_battery_cell_readings(p_vehicle_id BIGINT)
RETURNS TABLE (cell_id INTEGER, voltage NUMERIC, temp NUMERIC, v_deviation NUMERIC, t_deviation NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT bc.cell_id, bc.voltage, bc.temperature
    FROM battery_cells bc
    WHERE bc.vehicle_id = p_vehicle_id
      AND bc.created_at = (SELECT MAX(created_at) FROM battery_cells WHERE vehicle_id = p_vehicle_id)
  ),
  stats AS (SELECT AVG(voltage) AS avg_v, AVG(temperature) AS avg_t FROM latest)
  SELECT l.cell_id::integer, ROUND(l.voltage::numeric, 4), ROUND(l.temperature::numeric, 1),
    ROUND((l.voltage - s.avg_v)::numeric, 4), ROUND((l.temperature - s.avg_t)::numeric, 1)
  FROM latest l, stats s ORDER BY l.cell_id;
END;
$$ LANGUAGE plpgsql STABLE;
