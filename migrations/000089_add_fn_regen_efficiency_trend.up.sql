CREATE OR REPLACE FUNCTION fn_regen_efficiency_trend(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (time TIMESTAMPTZ, regen_pct NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.start_date,
    CASE WHEN d.energy_used_kwh > 0
      THEN ROUND((d.energy_regen_kwh / d.energy_used_kwh * 100)::numeric, 1)
      ELSE NULL END
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.energy_regen_kwh IS NOT NULL
    AND d.energy_used_kwh > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date;
END;
$$ LANGUAGE plpgsql STABLE;
