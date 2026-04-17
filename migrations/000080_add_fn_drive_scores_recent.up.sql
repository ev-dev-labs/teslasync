CREATE OR REPLACE FUNCTION fn_drive_scores_recent(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (date TIMESTAMPTZ, distance NUMERIC, avg_speed NUMERIC, score INTEGER, grade TEXT, wh_per_km NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      d.start_date,
      d.distance,
      d.speed_avg,
      CASE WHEN d.distance > 0
        THEN ROUND(((COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) * 1000 / d.distance)::numeric, 0)
        ELSE NULL END AS computed_wh_per_km
    FROM drives d
    WHERE d.vehicle_id = p_vehicle_id
      AND d.distance > 1
      AND (p_from IS NULL OR d.start_date >= p_from)
      AND (p_to IS NULL OR d.start_date <= p_to)
  )
  SELECT
    s.start_date,
    ROUND(s.distance::numeric, 1),
    ROUND(s.speed_avg::numeric, 1),
    GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3))))::integer,
    CASE
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 90 THEN 'A'
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 80 THEN 'B'
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 70 THEN 'C'
      WHEN GREATEST(0, LEAST(100, (100 - GREATEST(0, (s.computed_wh_per_km - 120) * 0.3)))) >= 60 THEN 'D'
      ELSE 'F'
    END,
    s.computed_wh_per_km
  FROM scored s
  WHERE s.computed_wh_per_km IS NOT NULL
  ORDER BY s.start_date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
