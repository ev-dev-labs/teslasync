CREATE OR REPLACE FUNCTION fn_true_cost_totals(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (ev_total NUMERIC, gas_total NUMERIC, savings NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(SUM(COALESCE(cs.cost, 0))::numeric, 2),
    ROUND(SUM(COALESCE(cs.gas_equivalent_cost, 0))::numeric, 2),
    ROUND(SUM(COALESCE(cs.gas_equivalent_cost, 0) - COALESCE(cs.cost, 0))::numeric, 2)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR cs.start_date >= p_from)
    AND (p_to IS NULL OR cs.start_date <= p_to);
END;
$$ LANGUAGE plpgsql STABLE;
