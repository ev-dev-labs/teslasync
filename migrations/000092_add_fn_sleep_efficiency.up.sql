CREATE OR REPLACE FUNCTION fn_sleep_efficiency(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE ("time" TIMESTAMPTZ, duration_hours NUMERIC, soc_loss NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT vd.start_date, ROUND(vd.duration_hours::numeric, 1),
    ROUND(vd.battery_lost::numeric, 1)
  FROM vampire_drain_events vd
  WHERE vd.vehicle_id = p_vehicle_id
    AND (p_from IS NULL OR vd.start_date >= p_from)
    AND (p_to IS NULL OR vd.start_date <= p_to)
  ORDER BY vd.start_date;
END;
$$ LANGUAGE plpgsql STABLE;
