CREATE OR REPLACE FUNCTION fn_battery_charge_cycles(p_vehicle_id BIGINT)
RETURNS TABLE (cycles NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ROUND((SUM(cs.charge_energy_added) / NULLIF(
    (SELECT bs.capacity_kwh FROM battery_snapshots bs
     WHERE bs.vehicle_id = p_vehicle_id ORDER BY bs.created_at DESC LIMIT 1), 0
  ))::numeric)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql STABLE;
