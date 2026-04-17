CREATE OR REPLACE FUNCTION fn_driving_speed_vs_efficiency(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (avg_speed NUMERIC, wh_per_km NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(d.avg_speed::numeric, 1),
    CASE WHEN d.distance > 0
      THEN ROUND((d.energy_used_kwh * 1000 / d.distance)::numeric, 0)
      ELSE NULL END
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.distance > 1 AND d.avg_speed > 0 AND d.energy_used_kwh > 0
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$ LANGUAGE plpgsql STABLE;
