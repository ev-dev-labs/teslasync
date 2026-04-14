-- Add is_gear_capable flag to vehicles table.
-- Persists whether a vehicle has ever sent a Gear signal via Fleet Telemetry,
-- allowing the FSM to survive restarts without falling back to speed-based detection.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_gear_capable BOOLEAN NOT NULL DEFAULT FALSE;
