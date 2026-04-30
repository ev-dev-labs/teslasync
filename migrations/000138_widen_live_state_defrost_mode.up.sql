-- Migration 138: Change vehicle_live_state.defrost_mode from BOOLEAN to VARCHAR(50).
-- DefrostMode is a 4-value enum (Off, Normal, Max, AutoDefog), not a boolean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_live_state'
      AND column_name = 'defrost_mode'
      AND data_type = 'boolean'
  ) THEN
    ALTER TABLE vehicle_live_state
      ALTER COLUMN defrost_mode TYPE VARCHAR(50)
      USING CASE WHEN defrost_mode THEN 'Normal' ELSE 'Off' END;
  END IF;
END $$;
