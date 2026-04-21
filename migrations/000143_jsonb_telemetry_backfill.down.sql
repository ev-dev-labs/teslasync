-- Down: clear signals column so a re-run of the backfill is idempotent.
-- Typed columns were not modified during backfill, so there is nothing else
-- to restore. The columns themselves are dropped in 000144 (and its .down
-- restores them individually).

UPDATE charging_telemetry SET signals = '{}'::jsonb;
UPDATE climate_snapshots SET signals = '{}'::jsonb;
UPDATE security_events SET signals = '{}'::jsonb;
UPDATE motor_snapshots SET signals = '{}'::jsonb;
UPDATE tire_pressure_snapshots SET signals = '{}'::jsonb;
UPDATE media_snapshots SET signals = '{}'::jsonb;
UPDATE safety_snapshots SET signals = '{}'::jsonb;
UPDATE vehicle_config_snapshots SET signals = '{}'::jsonb;
UPDATE user_preference_snapshots SET signals = '{}'::jsonb;
