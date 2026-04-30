-- Add charger spec summary fields to charging_sessions
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS max_charger_voltage smallint;
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS charger_phases smallint;
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS cable_type text;

COMMENT ON COLUMN charging_sessions.max_charger_voltage IS
  'Peak charger voltage (V) observed during session, from ChargerVoltage signal.';
COMMENT ON COLUMN charging_sessions.charger_phases IS
  'AC phases used (1 or 3), from ChargerPhases signal.';
COMMENT ON COLUMN charging_sessions.cable_type IS
  'Charging cable type, from ChargingCableType signal.';

-- Backfill existing sessions from signal_log (best-effort, skip on error)
DO $$
BEGIN
  UPDATE charging_sessions cs SET
      max_charger_voltage = sub.max_v::smallint,
      charger_phases = sub.phases::smallint,
      cable_type = sub.cable
  FROM (
      SELECT
          cs2.id,
          MAX(sl.value_num) FILTER (WHERE sl.signal_name = 'ChargerVoltage') AS max_v,
          MAX(sl.value_num) FILTER (WHERE sl.signal_name = 'ChargerPhases') AS phases,
          MAX(sl.value_text) FILTER (WHERE sl.signal_name = 'ChargingCableType') AS cable
      FROM charging_sessions cs2
      JOIN signal_log sl ON sl.vehicle_id = cs2.vehicle_id
          AND sl.ts BETWEEN cs2.start_ts AND COALESCE(cs2.end_ts, NOW())
          AND sl.signal_name IN ('ChargerVoltage', 'ChargerPhases', 'ChargingCableType')
      WHERE cs2.max_charger_voltage IS NULL
      GROUP BY cs2.id
  ) sub
  WHERE cs.id = sub.id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Backfill skipped: %', SQLERRM;
END $$;
