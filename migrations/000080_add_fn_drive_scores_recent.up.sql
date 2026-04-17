CREATE OR REPLACE FUNCTION fn_drive_scores_recent(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (date TIMESTAMPTZ, distance NUMERIC, avg_speed NUMERIC, score INTEGER, grade TEXT, wh_per_km NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.start_date,
    ROUND(d.distance::numeric, 1),
    ROUND(d.avg_speed::numeric, 1),
    d.drive_score,
    CASE
      WHEN d.drive_score >= 90 THEN 'A'
      WHEN d.drive_score >= 80 THEN 'B'
      WHEN d.drive_score >= 70 THEN 'C'
      WHEN d.drive_score >= 60 THEN 'D'
      ELSE 'F'
    END,
    CASE WHEN d.distance > 0
      THEN ROUND((d.energy_used_kwh * 1000 / d.distance)::numeric, 0)
      ELSE NULL END
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.drive_score IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
