-- Migration 38: Fix more column type mismatches in vehicle_config_snapshots
-- rear_seat_heaters, sunroof_installed, efficiency_package are enum strings from Tesla, not booleans

ALTER TABLE vehicle_config_snapshots ALTER COLUMN rear_seat_heaters TYPE VARCHAR(100) USING CASE WHEN rear_seat_heaters THEN 'Present' ELSE 'None' END;
ALTER TABLE vehicle_config_snapshots ALTER COLUMN sunroof_installed TYPE VARCHAR(100) USING CASE WHEN sunroof_installed THEN 'Present' ELSE 'None' END;
ALTER TABLE vehicle_config_snapshots ALTER COLUMN efficiency_package TYPE VARCHAR(100) USING CASE WHEN efficiency_package THEN 'Present' ELSE 'None' END;
