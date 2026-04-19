-- Migration 121: Fix blind_spot_collision_warning column type in safety_snapshots.
-- This column was incorrectly converted from BOOLEAN to VARCHAR(100) in migration 037
-- along with true enum signals (forward_collision_warning, lane_departure_avoidance).
-- BlindSpotCollisionWarningChime is TypeBool in the signal registry and always arrives
-- as a boolean from Fleet Telemetry. Convert back to BOOLEAN.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'safety_snapshots'
      AND column_name = 'blind_spot_collision_warning'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE safety_snapshots
      ALTER COLUMN blind_spot_collision_warning TYPE BOOLEAN
      USING CASE
        WHEN lower(blind_spot_collision_warning) IN ('true', '1', 'on') THEN TRUE
        WHEN lower(blind_spot_collision_warning) IN ('false', '0', 'off') THEN FALSE
        ELSE NULL
      END;
  END IF;
END $$;
