-- Lossy rollback: existing string values cannot be cast to boolean,
-- so we null them out on downgrade.
ALTER TABLE vehicle_live_state ALTER COLUMN gps_state TYPE BOOLEAN USING NULL;
