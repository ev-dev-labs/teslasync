-- Widen door_state columns to TEXT to accommodate JSON compound values
-- from Tesla Fleet Telemetry (e.g. '{"DriverFront":true,"PassengerFront":false,...}').
ALTER TABLE vehicle_live_state ALTER COLUMN door_state TYPE TEXT;
ALTER TABLE security_events ALTER COLUMN door_state TYPE TEXT;
