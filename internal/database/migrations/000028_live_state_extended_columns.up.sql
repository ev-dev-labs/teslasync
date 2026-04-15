-- Migration 028: Add all missing signalToColumn columns to vehicle_live_state
-- and widen climate_snapshots.cabin_overheat_protection_temp_limit.
-- Fixes: RouteLine varchar overflow, TPMS timestamp columns, climate enum column.

-- ============================================================================
-- 1. Widen climate_snapshots enum column (Bug 2)
-- ============================================================================
-- "ClimateOverheatProtectionTempLimitLow" is 44 chars, VARCHAR(20) overflows.
ALTER TABLE climate_snapshots
    ALTER COLUMN cabin_overheat_protection_temp_limit TYPE VARCHAR(60);

-- ============================================================================
-- 2. Add missing columns to vehicle_live_state
-- ============================================================================

-- Security / Vehicle Access
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS guest_mode BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS guest_mode_mobile_access VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS homelink_nearby BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS homelink_device_count INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS driver_seat_occupied BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS speed_limit_mode VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS valet_mode_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS service_mode BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS current_limit_mph DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS paired_phone_key_count INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lights_hazards_active BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lights_high_beams BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lights_turn_signal VARCHAR(50);

-- Software Update
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS sw_update_version VARCHAR(100);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS sw_update_download_pct INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS sw_update_install_pct INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS sw_update_expected_duration INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS sw_update_scheduled_start VARCHAR(100);

-- State Machine (pod restart recovery)
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS last_gear VARCHAR(30);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS last_speed_time TIMESTAMPTZ;

-- Vehicle Configuration
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS trim VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS roof_color VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS efficiency_package VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS rear_seat_heaters INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS sunroof_installed BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS europe_vehicle BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS right_hand_drive BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS remote_start_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS offroad_lightbar_present BOOLEAN;

-- Charging Extended
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS ac_charging_energy_in DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_current_request DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_current_request_max DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_enable_request BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_port VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_port_cold_weather_mode BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_port_door_open BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charge_port_latch VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS charger_phases INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS dc_charging_energy_in DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS estimated_hours_to_charge_termination DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS fast_charger_present BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS fast_charger_type VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS scheduled_charging_mode VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS scheduled_charging_pending BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS scheduled_charging_start_time VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS scheduled_departure_time VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS supercharger_session_trip_planner VARCHAR(100);

-- Motor / Powertrain
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS brake_pedal_pos DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS dcdc_enable BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_axle_speed_f DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_axle_speed_r DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_axle_speed_rel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_axle_speed_rer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_heatsink_tf DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_heatsink_tr DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_heatsink_trel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_heatsink_trer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_inverter_tf DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_inverter_tr DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_inverter_trel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_inverter_trer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_motor_current_f DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_motor_current_r DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_motor_current_rel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_motor_current_rer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_slave_torque_cmd DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_state_f VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_state_r VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_state_rel VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_state_rer VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_stator_temp_f DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_stator_temp_r DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_stator_temp_rel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_stator_temp_rer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_torque_actual_f DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_torque_actual_r DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_torque_actual_rel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_torque_actual_rer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_torquemotor DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_v_bat_f DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_v_bat_r DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_v_bat_rel DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS di_v_bat_rer DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS drive_rail BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvil VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS cruise_set_speed DOUBLE PRECISION;

-- Climate Extended
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_fan_speed INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS auto_seat_climate_left BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS auto_seat_climate_right BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS cabin_overheat_protection_mode VARCHAR(60);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS cabin_overheat_protection_temperature_limit VARCHAR(60);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS climate_keeper_mode VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS climate_seat_cooling_front_left INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS climate_seat_cooling_front_right INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS defrost_for_preconditioning BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS defrost_mode VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_ac_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_auto_mode VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_fan_status INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_left_temperature_request DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_right_temperature_request DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_steering_wheel_heat_auto BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS hvac_steering_wheel_heat_level INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS not_enough_power_to_heat BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS preconditioning_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS rear_defrost_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS rear_display_hvac_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS seat_heater_left INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS seat_heater_right INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS seat_heater_rear_left INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS seat_heater_rear_center INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS seat_heater_rear_right INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS seat_vent_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS wiper_heat_enabled BOOLEAN;

-- Safety / ADAS
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS automatic_blind_spot_camera BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS automatic_emergency_braking_off BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS blind_spot_collision_warning_chime BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS cruise_follow_distance INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS driver_seat_belt BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS emergency_lane_departure_avoidance VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS forward_collision_warning VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lane_departure_avoidance VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS passenger_seat_belt BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS speed_limit_warning VARCHAR(50);

-- Media
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_audio_volume DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_audio_volume_increment DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_audio_volume_max DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_now_playing_album VARCHAR(255);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_now_playing_artist VARCHAR(255);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_now_playing_duration DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_now_playing_elapsed DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_now_playing_station VARCHAR(255);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_now_playing_title VARCHAR(255);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_playback_source VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS media_playback_status VARCHAR(50);

-- Navigation (Bug 1: route_line must be TEXT for base64 route data)
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS destination_name VARCHAR(255);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS expected_energy_percent_at_trip_arrival DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS miles_since_reset DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS miles_to_arrival DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS minutes_to_arrival DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS route_last_updated VARCHAR(100);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS route_line TEXT;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS route_traffic_minutes_delay DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS self_driving_miles_since_reset DOUBLE PRECISION;

-- TPMS Extended (Bug 3: timestamp columns as TIMESTAMPTZ, not float)
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tpms_hard_warnings INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tpms_last_seen_pressure_time_fl TIMESTAMPTZ;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tpms_last_seen_pressure_time_fr TIMESTAMPTZ;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tpms_last_seen_pressure_time_rl TIMESTAMPTZ;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tpms_last_seen_pressure_time_rr TIMESTAMPTZ;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tpms_soft_warnings INTEGER;

-- Battery / BMS
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS bms_state VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS battery_heater_on BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS bms_fullchargecomplete BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS brick_voltage_max DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS brick_voltage_min DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS isolation_resistance DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lifetime_energy_gained_regen DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lifetime_energy_used DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lifetime_energy_used_drive DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS module_temp_max DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS module_temp_min DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS num_brick_voltage_max INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS num_brick_voltage_min INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS num_module_temp_max INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS num_module_temp_min INTEGER;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS pack_current DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS pack_voltage DOUBLE PRECISION;

-- User Preferences
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS setting24_hour_time BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS setting_charge_unit VARCHAR(20);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS setting_distance_unit VARCHAR(20);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS setting_temperature_unit VARCHAR(20);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS setting_tire_pressure_unit VARCHAR(20);

-- Powershare
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS powershare_hours_left DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS powershare_instantaneous_power_kw DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS powershare_status VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS powershare_stop_reason VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS powershare_type VARCHAR(50);

-- Other
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS lateral_acceleration DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS located_at_favorite BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS located_at_home BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS located_at_work BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS longitudinal_acceleration DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS pin_to_drive_enabled BOOLEAN;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tonneau_open_percent DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tonneau_position VARCHAR(50);
ALTER TABLE vehicle_live_state ADD COLUMN IF NOT EXISTS tonneau_tent_mode BOOLEAN;

-- ============================================================================
-- 3. Add route_last_updated to location_snapshots
-- ============================================================================
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS route_last_updated VARCHAR(100);
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS current_lon DOUBLE PRECISION;
