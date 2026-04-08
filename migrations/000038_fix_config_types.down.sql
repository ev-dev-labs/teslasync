-- Migration 38 (down)
ALTER TABLE vehicle_config_snapshots ALTER COLUMN rear_seat_heaters TYPE BOOLEAN USING rear_seat_heaters IS NOT NULL AND rear_seat_heaters != 'None';
ALTER TABLE vehicle_config_snapshots ALTER COLUMN sunroof_installed TYPE BOOLEAN USING sunroof_installed IS NOT NULL AND sunroof_installed != 'None';
ALTER TABLE vehicle_config_snapshots ALTER COLUMN efficiency_package TYPE BOOLEAN USING efficiency_package IS NOT NULL AND efficiency_package != 'None';
