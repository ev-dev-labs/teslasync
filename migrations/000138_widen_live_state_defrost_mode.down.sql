-- Migration 138 (down): Revert defrost_mode to BOOLEAN.
ALTER TABLE vehicle_live_state
  ALTER COLUMN defrost_mode TYPE BOOLEAN
  USING CASE WHEN defrost_mode = 'Off' OR defrost_mode IS NULL THEN false ELSE true END;
