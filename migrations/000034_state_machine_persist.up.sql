-- Migration 34: Persist state machine fields for pod restart recovery
ALTER TABLE vehicle_live_state
  ADD COLUMN IF NOT EXISTS last_gear VARCHAR(10),
  ADD COLUMN IF NOT EXISTS last_speed_time TIMESTAMPTZ;
