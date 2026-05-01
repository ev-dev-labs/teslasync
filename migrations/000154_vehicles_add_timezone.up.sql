-- Phase 40 / Prompt 22: per-vehicle IANA timezone for "vehicle local time" rendering.
--
-- Tesla's vehicle_data response carries `vehicle_state.timezone` as an IANA
-- name (e.g. "America/Los_Angeles"). The worker now persists this on every
-- successful poll so the frontend can render drive/charge timestamps in the
-- car's local time rather than the user's browser time. UTC is a safe default
-- for un-learned vehicles; the frontend treats 'UTC' as "fall back to user TZ".
BEGIN;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN vehicles.timezone IS
  'IANA tz database name from Tesla vehicle_state.timezone (e.g. America/Los_Angeles). '
  'Used to render vehicle-anchored timestamps (drive start, charge end) in the car''s '
  'local time. Defaults to UTC; the frontend falls back to user TZ when the value is UTC.';

COMMIT;
