CREATE OR REPLACE FUNCTION fn_true_cost_per_km(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (month TIMESTAMPTZ, ev_per_km NUMERIC, gas_per_km NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH monthly AS (
    SELECT DATE_TRUNC('month', d.start_date) AS m, SUM(d.distance) AS dist
    FROM drives d WHERE d.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR d.start_date >= p_from) AND (p_to IS NULL OR d.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', d.start_date)
  ),
  costs AS (
    SELECT DATE_TRUNC('month', cs.start_date) AS m,
      SUM(COALESCE(cs.cost, 0)) AS ev
    FROM charging_sessions cs WHERE cs.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR cs.start_date >= p_from) AND (p_to IS NULL OR cs.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', cs.start_date)
  )
  SELECT m.m, ROUND((COALESCE(c.ev, 0) / NULLIF(m.dist, 0))::numeric, 3),
    0.12::numeric
  FROM monthly m LEFT JOIN costs c ON m.m = c.m ORDER BY m.m;
END;
$$ LANGUAGE plpgsql STABLE;
