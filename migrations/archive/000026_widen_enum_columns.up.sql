-- Migration 26: Widen varchar columns for Tesla Fleet Telemetry enum values
-- Tesla sends enum values with type prefixes (e.g. "DetailedChargeStateCharging",
-- "DisplayStateDriving", "GuestModeMobileAccessNoAccess") that exceed the original
-- varchar(10-20) limits.

-- motor_snapshots
ALTER TABLE motor_snapshots ALTER COLUMN di_state TYPE varchar(50);
ALTER TABLE motor_snapshots ALTER COLUMN gear TYPE varchar(30);
ALTER TABLE motor_snapshots ALTER COLUMN di_state_f TYPE varchar(50);
ALTER TABLE motor_snapshots ALTER COLUMN di_state_rel TYPE varchar(50);
ALTER TABLE motor_snapshots ALTER COLUMN di_state_rer TYPE varchar(50);
ALTER TABLE motor_snapshots ALTER COLUMN hvil TYPE varchar(50);

-- security_events
ALTER TABLE security_events ALTER COLUMN door_state TYPE varchar(100);
ALTER TABLE security_events ALTER COLUMN fd_window TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN fp_window TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN rd_window TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN rp_window TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN guest_mode_mobile_access_state TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN center_display TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN speed_limit_mode TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN lights_turn_signal TYPE varchar(50);
ALTER TABLE security_events ALTER COLUMN tonneau_position TYPE varchar(50);

-- charging_telemetry
ALTER TABLE charging_telemetry ALTER COLUMN charge_state TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN detailed_charge_state TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN charge_port_latch TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN charging_cable_type TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN fast_charger_type TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN scheduled_charging_mode TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN bms_state TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN powershare_status TYPE varchar(50);
ALTER TABLE charging_telemetry ALTER COLUMN powershare_type TYPE varchar(50);

-- climate_snapshots
ALTER TABLE climate_snapshots ALTER COLUMN cabin_overheat_mode TYPE varchar(50);
ALTER TABLE climate_snapshots ALTER COLUMN climate_keeper_mode TYPE varchar(50);

-- safety_snapshots
ALTER TABLE safety_snapshots ALTER COLUMN cruise_follow_distance TYPE varchar(50);
ALTER TABLE safety_snapshots ALTER COLUMN speed_limit_warning TYPE varchar(50);

-- vehicle_config_snapshots
ALTER TABLE vehicle_config_snapshots ALTER COLUMN charge_port TYPE varchar(50);

-- media_snapshots
ALTER TABLE media_snapshots ALTER COLUMN playback_status TYPE varchar(50);

-- location_snapshots
ALTER TABLE location_snapshots ALTER COLUMN gps_state TYPE varchar(50);

-- user_preference_snapshots
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_charge_unit TYPE varchar(50);
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_distance_unit TYPE varchar(50);
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_temperature_unit TYPE varchar(50);
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_tire_pressure_unit TYPE varchar(50);
