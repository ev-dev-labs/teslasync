CREATE OR REPLACE FUNCTION fn_battery_risk_factors(p_vehicle_id BIGINT)
RETURNS TABLE (metric TEXT, value NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT 'Fast Charge %'::text,
    ROUND(100.0 * COUNT(*) FILTER (WHERE cs.charger_power > 50) / NULLIF(COUNT(*), 0))
  FROM charging_sessions cs WHERE cs.vehicle_id = p_vehicle_id
  UNION ALL
  SELECT 'High SoC Charges',
    ROUND(100.0 * COUNT(*) FILTER (WHERE cs.end_battery_level > 90) / NULLIF(COUNT(*), 0))
  FROM charging_sessions cs WHERE cs.vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql STABLE;
