CREATE OR REPLACE FUNCTION fn_driving_style_summary(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (style TEXT, percent NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH classified AS (
    SELECT
      CASE
        WHEN d.avg_speed < 40 AND COALESCE(d.energy_used_kwh / NULLIF(d.distance, 0) * 1000, 0) < 150 THEN 'Gentle'
        WHEN d.avg_speed > 80 OR COALESCE(d.energy_used_kwh / NULLIF(d.distance, 0) * 1000, 0) > 250 THEN 'Aggressive'
        ELSE 'Moderate'
      END AS style
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND d.distance > 1
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
  )
  SELECT c.style, ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM classified), 0), 1)
  FROM classified c
  GROUP BY c.style;
END;
$$ LANGUAGE plpgsql STABLE;
