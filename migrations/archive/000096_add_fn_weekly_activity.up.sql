CREATE OR REPLACE FUNCTION fn_weekly_activity(p_vehicle_id BIGINT)
RETURNS TABLE (type TEXT, start_time TIMESTAMPTZ, from_loc TEXT, to_loc TEXT, distance NUMERIC, duration_min NUMERIC, energy_added NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT 'Drive'::text, d.start_date, COALESCE(d.start_address, '—')::text,
    COALESCE(d.end_address, '—')::text, ROUND(d.distance::numeric, 1),
    ROUND(d.duration_min::numeric, 0), NULL::numeric
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.start_date >= DATE_TRUNC('week', NOW())
  UNION ALL
  SELECT 'Charge', cs.start_date, COALESCE(cs.location_name, '—')::text, '—'::text, NULL,
    ROUND(EXTRACT(EPOCH FROM cs.end_date - cs.start_date) / 60, 0)::numeric,
    ROUND(cs.charge_energy_added::numeric, 1)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id AND cs.start_date >= DATE_TRUNC('week', NOW())
  ORDER BY 2 DESC;
END;
$$ LANGUAGE plpgsql STABLE;
