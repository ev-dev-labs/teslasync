CREATE OR REPLACE FUNCTION fn_battery_cell_temp_heatmap(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, cell_id INTEGER, temp DOUBLE PRECISION) AS $$
BEGIN
  RETURN QUERY
  SELECT bc.created_at, bc.cell_id::integer, bc.temperature
  FROM battery_cells bc
  WHERE bc.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR bc.created_at >= p_from)
    AND (p_to IS NULL OR bc.created_at <= p_to)
  ORDER BY bc.created_at, bc.cell_id;
END;
$$ LANGUAGE plpgsql STABLE;
