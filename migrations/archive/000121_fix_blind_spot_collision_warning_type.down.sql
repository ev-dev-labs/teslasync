-- Migration 121 (down): Revert blind_spot_collision_warning back to VARCHAR(100)
ALTER TABLE safety_snapshots
  ALTER COLUMN blind_spot_collision_warning TYPE VARCHAR(100)
  USING CASE WHEN blind_spot_collision_warning THEN 'true' ELSE 'false' END;
