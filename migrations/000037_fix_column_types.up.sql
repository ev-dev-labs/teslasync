-- Migration 37: Fix column type mismatches — booleans that receive enum strings
-- Fleet Telemetry sends these as enum strings (e.g., "HvacAutoModeStateOn",
-- "ForwardCollisionSensitivityEarly") not booleans.
-- On fresh install these are already VARCHAR (fixed in 016/017), so use DO block to check.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='climate_snapshots' AND column_name='hvac_auto_mode' AND data_type='boolean') THEN
    ALTER TABLE climate_snapshots ALTER COLUMN hvac_auto_mode TYPE VARCHAR(100) USING CASE WHEN hvac_auto_mode THEN 'On' ELSE 'Off' END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='climate_snapshots' AND column_name='defrost_mode' AND data_type='boolean') THEN
    ALTER TABLE climate_snapshots ALTER COLUMN defrost_mode TYPE VARCHAR(50) USING CASE WHEN defrost_mode THEN 'On' ELSE 'Off' END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='safety_snapshots' AND column_name='forward_collision_warning' AND data_type='boolean') THEN
    ALTER TABLE safety_snapshots ALTER COLUMN forward_collision_warning TYPE VARCHAR(100) USING CASE WHEN forward_collision_warning THEN 'On' ELSE 'Off' END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='safety_snapshots' AND column_name='lane_departure_avoidance' AND data_type='boolean') THEN
    ALTER TABLE safety_snapshots ALTER COLUMN lane_departure_avoidance TYPE VARCHAR(100) USING CASE WHEN lane_departure_avoidance THEN 'On' ELSE 'Off' END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='safety_snapshots' AND column_name='blind_spot_collision_warning' AND data_type='boolean') THEN
    ALTER TABLE safety_snapshots ALTER COLUMN blind_spot_collision_warning TYPE VARCHAR(100) USING CASE WHEN blind_spot_collision_warning THEN 'On' ELSE 'Off' END;
  END IF;
END $$;
