-- Migration 37: Fix column type mismatches — booleans that receive enum strings
-- Fleet Telemetry sends these as enum strings (e.g., "HvacAutoModeStateOn",
-- "ForwardCollisionSensitivityEarly") not booleans.

-- climate_snapshots
ALTER TABLE climate_snapshots ALTER COLUMN hvac_auto_mode TYPE VARCHAR(100) USING CASE WHEN hvac_auto_mode THEN 'On' ELSE 'Off' END;
ALTER TABLE climate_snapshots ALTER COLUMN defrost_mode TYPE VARCHAR(50) USING CASE WHEN defrost_mode THEN 'On' ELSE 'Off' END;

-- safety_snapshots
ALTER TABLE safety_snapshots ALTER COLUMN forward_collision_warning TYPE VARCHAR(100) USING CASE WHEN forward_collision_warning THEN 'On' ELSE 'Off' END;
ALTER TABLE safety_snapshots ALTER COLUMN lane_departure_avoidance TYPE VARCHAR(100) USING CASE WHEN lane_departure_avoidance THEN 'On' ELSE 'Off' END;
ALTER TABLE safety_snapshots ALTER COLUMN blind_spot_collision_warning TYPE VARCHAR(100) USING CASE WHEN blind_spot_collision_warning THEN 'On' ELSE 'Off' END;
