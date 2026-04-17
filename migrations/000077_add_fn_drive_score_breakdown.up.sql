CREATE OR REPLACE FUNCTION fn_drive_score_breakdown(
  p_vehicle_id BIGINT,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (category TEXT, score NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT 'Efficiency'::text, ROUND(AVG(d.efficiency_score)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.efficiency_score IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  UNION ALL
  SELECT 'Smoothness'::text, ROUND(AVG(d.smoothness_score)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.smoothness_score IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  UNION ALL
  SELECT 'Speed'::text, ROUND(AVG(d.speed_score)::numeric, 0)
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id AND d.speed_score IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$ LANGUAGE plpgsql STABLE;
