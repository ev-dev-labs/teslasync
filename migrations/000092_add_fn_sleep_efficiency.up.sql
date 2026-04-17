CREATE OR REPLACE FUNCTION fn_sleep_efficiency(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, duration_hours NUMERIC, soc_loss NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT vd.start_time, ROUND(vd.duration_hours::numeric, 1),
    ROUND(vd.soc_loss_pct::numeric, 1)
  FROM vampire_drain_events vd
  WHERE vd.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR vd.start_time >= p_from)
    AND (p_to IS NULL OR vd.start_time <= p_to)
  ORDER BY vd.start_time;
END;
$$ LANGUAGE plpgsql STABLE;
