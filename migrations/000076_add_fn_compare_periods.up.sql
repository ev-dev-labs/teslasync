CREATE OR REPLACE FUNCTION fn_compare_periods(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ
)
RETURNS TABLE (period TEXT, distance NUMERIC, drives BIGINT, energy NUMERIC) AS $$
DECLARE
  v_duration INTERVAL;
BEGIN
  v_duration := p_to - p_from;
  RETURN QUERY
  SELECT 'Current'::text,
    COALESCE(SUM(d.distance), 0)::numeric, COUNT(*)::bigint,
    COALESCE(SUM(d.energy_used_kwh), 0)::numeric
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.start_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'Prior'::text,
    COALESCE(SUM(d.distance), 0)::numeric, COUNT(*)::bigint,
    COALESCE(SUM(d.energy_used_kwh), 0)::numeric
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.start_date BETWEEN (p_from - v_duration) AND p_from;
END;
$$ LANGUAGE plpgsql STABLE;
