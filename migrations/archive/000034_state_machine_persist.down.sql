-- Migration 34 (down)
ALTER TABLE vehicle_live_state
  DROP COLUMN IF EXISTS last_gear,
  DROP COLUMN IF EXISTS last_speed_time;
