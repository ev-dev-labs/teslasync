-- Migration 26 (down): Revert varchar column widening
-- Note: This is a best-effort revert. Data that exceeds the original limits
-- would need to be truncated first.

ALTER TABLE motor_snapshots ALTER COLUMN di_state TYPE varchar(20);
ALTER TABLE motor_snapshots ALTER COLUMN gear TYPE varchar(5);
ALTER TABLE motor_snapshots ALTER COLUMN di_state_f TYPE varchar(20);
ALTER TABLE motor_snapshots ALTER COLUMN di_state_rel TYPE varchar(20);
ALTER TABLE motor_snapshots ALTER COLUMN di_state_rer TYPE varchar(20);
ALTER TABLE motor_snapshots ALTER COLUMN hvil TYPE varchar(20);

ALTER TABLE security_events ALTER COLUMN door_state TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN fd_window TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN fp_window TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN rd_window TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN rp_window TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN guest_mode_mobile_access_state TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN center_display TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN speed_limit_mode TYPE varchar(20);
ALTER TABLE security_events ALTER COLUMN lights_turn_signal TYPE varchar(10);
ALTER TABLE security_events ALTER COLUMN tonneau_position TYPE varchar(20);

ALTER TABLE charging_telemetry ALTER COLUMN charge_state TYPE varchar(30);
ALTER TABLE charging_telemetry ALTER COLUMN detailed_charge_state TYPE varchar(30);
ALTER TABLE charging_telemetry ALTER COLUMN charge_port_latch TYPE varchar(20);
ALTER TABLE charging_telemetry ALTER COLUMN charging_cable_type TYPE varchar(30);
ALTER TABLE charging_telemetry ALTER COLUMN fast_charger_type TYPE varchar(30);
ALTER TABLE charging_telemetry ALTER COLUMN scheduled_charging_mode TYPE varchar(20);
ALTER TABLE charging_telemetry ALTER COLUMN bms_state TYPE varchar(20);
ALTER TABLE charging_telemetry ALTER COLUMN powershare_status TYPE varchar(20);
ALTER TABLE charging_telemetry ALTER COLUMN powershare_type TYPE varchar(20);

ALTER TABLE climate_snapshots ALTER COLUMN cabin_overheat_mode TYPE varchar(10);
ALTER TABLE climate_snapshots ALTER COLUMN climate_keeper_mode TYPE varchar(20);

ALTER TABLE safety_snapshots ALTER COLUMN cruise_follow_distance TYPE varchar(10);
ALTER TABLE safety_snapshots ALTER COLUMN speed_limit_warning TYPE varchar(20);

ALTER TABLE vehicle_config_snapshots ALTER COLUMN charge_port TYPE varchar(20);

ALTER TABLE media_snapshots ALTER COLUMN playback_status TYPE varchar(20);

ALTER TABLE location_snapshots ALTER COLUMN gps_state TYPE varchar(20);

ALTER TABLE user_preference_snapshots ALTER COLUMN setting_charge_unit TYPE varchar(10);
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_distance_unit TYPE varchar(10);
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_temperature_unit TYPE varchar(10);
ALTER TABLE user_preference_snapshots ALTER COLUMN setting_tire_pressure_unit TYPE varchar(10);
