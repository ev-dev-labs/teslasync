-- Migration 38: Fix more column type mismatches in vehicle_config_snapshots
-- On fresh install these are already VARCHAR (fixed in 017), so use DO block.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicle_config_snapshots' AND column_name='rear_seat_heaters' AND data_type='boolean') THEN
    ALTER TABLE vehicle_config_snapshots ALTER COLUMN rear_seat_heaters TYPE VARCHAR(100) USING CASE WHEN rear_seat_heaters THEN 'Present' ELSE 'None' END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicle_config_snapshots' AND column_name='sunroof_installed' AND data_type='boolean') THEN
    ALTER TABLE vehicle_config_snapshots ALTER COLUMN sunroof_installed TYPE VARCHAR(100) USING CASE WHEN sunroof_installed THEN 'Present' ELSE 'None' END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicle_config_snapshots' AND column_name='efficiency_package' AND data_type='boolean') THEN
    ALTER TABLE vehicle_config_snapshots ALTER COLUMN efficiency_package TYPE VARCHAR(100) USING CASE WHEN efficiency_package THEN 'Present' ELSE 'None' END;
  END IF;
END $$;
