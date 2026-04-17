-- Add acceleration_gs column to drive_telemetry_readings
ALTER TABLE drive_telemetry_readings
  ADD COLUMN IF NOT EXISTS acceleration_gs DOUBLE PRECISION;

-- Function: raw acceleration G readings for distribution analysis
CREATE OR REPLACE FUNCTION fn_driving_acceleration_distribution(
  p_vehicle_id BIGINT, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (acceleration_gs DOUBLE PRECISION) AS $$
BEGIN
  RETURN QUERY
  SELECT dt.acceleration_gs
  FROM drive_telemetry_readings dt
  JOIN drives d ON dt.drive_id = d.id
  WHERE d.vehicle_id = p_vehicle_id
    AND dt.acceleration_gs IS NOT NULL
    AND (p_from IS NULL OR d.start_date >= p_from)
    AND (p_to IS NULL OR d.start_date <= p_to);
END;
$$ LANGUAGE plpgsql STABLE;
