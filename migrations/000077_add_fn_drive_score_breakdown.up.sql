CREATE OR REPLACE FUNCTION fn_drive_score_breakdown(
  p_vehicle_id BIGINT,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (category TEXT, score NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT 'Efficiency'::text,
    ROUND(AVG(
      CASE WHEN d.distance > 0
        AND (COALESCE(d.start_rated_range_km, 0) - COALESCE(d.end_rated_range_km, 0)) > 0
        THEN LEAST(100.0, 100.0 * d.distance / (d.start_rated_range_km - d.end_rated_range_km))
        ELSE NULL END
    )::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  UNION ALL
  SELECT 'Smoothness'::text,
    ROUND(AVG(
      CASE WHEN d.speed_max > 0 AND d.speed_avg > 0
        THEN LEAST(100.0, 100.0 * d.speed_avg / d.speed_max)
        ELSE NULL END
    )::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  UNION ALL
  SELECT 'Speed'::text,
    ROUND(AVG(
      CASE WHEN d.duration_min > 0 AND d.distance > 0
        THEN LEAST(100.0, (d.distance / d.duration_min * 60.0) / 1.2)
        ELSE NULL END
    )::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$ LANGUAGE plpgsql STABLE;
