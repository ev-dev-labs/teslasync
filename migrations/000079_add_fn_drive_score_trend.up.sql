CREATE OR REPLACE FUNCTION fn_drive_score_trend(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, score INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT d.start_date, d.drive_score
  FROM drives d
  WHERE d.vehicle_id = p_vehicle_id
    AND d.drive_score IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to)
  ORDER BY d.start_date;
END;
$$ LANGUAGE plpgsql STABLE;
