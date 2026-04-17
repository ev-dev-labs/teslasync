CREATE OR REPLACE FUNCTION fn_battery_cell_temp_heatmap(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, cell_id INTEGER, temp DOUBLE PRECISION) AS $$
BEGIN
  -- No battery_cells table; return empty result set
  RETURN QUERY
  SELECT NULL::timestamptz, NULL::integer, NULL::double precision
  WHERE false;
END;
$$ LANGUAGE plpgsql STABLE;
