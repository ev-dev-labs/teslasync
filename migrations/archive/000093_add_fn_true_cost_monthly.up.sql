CREATE OR REPLACE FUNCTION fn_true_cost_monthly(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (month TIMESTAMPTZ, ev_cost NUMERIC, gas_cost NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH charge_costs AS (
    SELECT DATE_TRUNC('month', cs.start_date) AS m,
      SUM(COALESCE(cs.cost, 0)) AS ev
    FROM charging_sessions cs
    WHERE cs.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR cs.start_date >= p_from)
      AND (p_to IS NULL OR cs.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', cs.start_date)
  ),
  drive_dist AS (
    SELECT DATE_TRUNC('month', d.start_date) AS m,
      SUM(COALESCE(d.distance, 0)) AS dist
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
    GROUP BY DATE_TRUNC('month', d.start_date)
  )
  SELECT COALESCE(c.m, dd.m),
    ROUND(COALESCE(c.ev, 0)::numeric, 2),
    ROUND((COALESCE(dd.dist, 0) * 0.12)::numeric, 2)
  FROM charge_costs c
  FULL OUTER JOIN drive_dist dd ON c.m = dd.m
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE;
