CREATE OR REPLACE FUNCTION fn_true_cost_totals(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (ev_total NUMERIC, gas_total NUMERIC, savings NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH ev AS (
    SELECT COALESCE(SUM(COALESCE(cs.cost, 0)), 0) AS total
    FROM charging_sessions cs
    WHERE cs.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR cs.start_date >= p_from)
      AND (p_to IS NULL OR cs.start_date <= p_to)
  ),
  gas AS (
    SELECT COALESCE(SUM(COALESCE(d.distance, 0)) * 0.12, 0) AS total
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
  )
  SELECT ROUND(ev.total::numeric, 2),
    ROUND(gas.total::numeric, 2),
    ROUND((gas.total - ev.total)::numeric, 2)
  FROM ev, gas;
END;
$$ LANGUAGE plpgsql STABLE;
