-- Migration 041: Fix telemetry type mismatches in existing databases
-- Applies on top of migration 040 (from previous branch) which added columns
-- but with incorrect types for some fields.

-- Bug 1: route_line must be TEXT (base64 route data can be 1000+ chars)
ALTER TABLE vehicle_live_state ALTER COLUMN route_line TYPE TEXT;

-- Bug 2: cabin_overheat_protection_temp_limit stores string enums like
-- "ClimateOverheatProtectionTempLimitLow" (44 chars), not numeric values.
-- Change from DOUBLE PRECISION to VARCHAR(60).
ALTER TABLE climate_snapshots
    ALTER COLUMN cabin_overheat_protection_temp_limit TYPE VARCHAR(60)
    USING cabin_overheat_protection_temp_limit::VARCHAR(60);

-- Also ensure the vehicle_live_state column is VARCHAR(60) not double precision
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicle_live_state'
          AND column_name = 'cabin_overheat_protection_temperature_limit'
          AND data_type = 'double precision'
    ) THEN
        ALTER TABLE vehicle_live_state
            ALTER COLUMN cabin_overheat_protection_temperature_limit TYPE VARCHAR(60)
            USING cabin_overheat_protection_temperature_limit::VARCHAR(60);
    END IF;
END $$;

-- Ensure any columns added by migration 028 that may not exist yet
-- (handles fresh installs that jump from 027 → 041)
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS route_last_updated VARCHAR(100);
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS current_lon DOUBLE PRECISION;
