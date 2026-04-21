-- Migration 37 (down)
ALTER TABLE climate_snapshots ALTER COLUMN hvac_auto_mode TYPE BOOLEAN USING hvac_auto_mode::boolean;
ALTER TABLE climate_snapshots ALTER COLUMN defrost_mode TYPE BOOLEAN USING defrost_mode::boolean;
ALTER TABLE safety_snapshots ALTER COLUMN forward_collision_warning TYPE BOOLEAN USING forward_collision_warning::boolean;
ALTER TABLE safety_snapshots ALTER COLUMN lane_departure_avoidance TYPE BOOLEAN USING lane_departure_avoidance::boolean;
ALTER TABLE safety_snapshots ALTER COLUMN blind_spot_collision_warning TYPE BOOLEAN USING blind_spot_collision_warning::boolean;
