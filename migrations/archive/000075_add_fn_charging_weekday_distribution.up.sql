CREATE OR REPLACE FUNCTION fn_charging_weekday_distribution(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (day TEXT, day_num DOUBLE PRECISION, sessions BIGINT, energy_kwh NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(cs.start_date, 'Dy')::text,
    EXTRACT(ISODOW FROM cs.start_date)::double precision,
    COUNT(*)::bigint,
    ROUND(SUM(COALESCE(cs.charge_energy_added, 0))::numeric, 1)
  FROM charging_sessions cs
  WHERE cs.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR cs.start_date >= p_from)
    AND (p_to IS NULL OR cs.start_date <= p_to)
  GROUP BY TO_CHAR(cs.start_date, 'Dy'), EXTRACT(ISODOW FROM cs.start_date)
  ORDER BY EXTRACT(ISODOW FROM cs.start_date);
END;
$$ LANGUAGE plpgsql STABLE;
