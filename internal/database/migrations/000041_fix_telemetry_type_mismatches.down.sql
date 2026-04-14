-- Migration 041 down: Revert telemetry type fixes

ALTER TABLE vehicle_live_state ALTER COLUMN route_line TYPE VARCHAR(200);

ALTER TABLE climate_snapshots
    ALTER COLUMN cabin_overheat_protection_temp_limit TYPE DOUBLE PRECISION
    USING NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicle_live_state'
          AND column_name = 'cabin_overheat_protection_temperature_limit'
          AND data_type = 'character varying'
    ) THEN
        ALTER TABLE vehicle_live_state
            ALTER COLUMN cabin_overheat_protection_temperature_limit TYPE DOUBLE PRECISION
            USING NULL;
    END IF;
END $$;

ALTER TABLE location_snapshots DROP COLUMN IF EXISTS route_last_updated;
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS current_lat;
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS current_lon;
