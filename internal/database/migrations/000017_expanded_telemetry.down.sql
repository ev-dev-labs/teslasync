-- Migration 000017 (down): Revert Expanded Telemetry
-- Drops all new tables and removes all added columns.

BEGIN;

-- ============================================================================
-- Drop new tables
-- ============================================================================

DROP TABLE IF EXISTS user_preference_snapshots;
DROP TABLE IF EXISTS safety_snapshots;
DROP TABLE IF EXISTS location_snapshots;
DROP TABLE IF EXISTS vehicle_config_snapshots;
DROP TABLE IF EXISTS media_snapshots;
DROP TABLE IF EXISTS charging_telemetry;

-- ============================================================================
-- Remove added columns from motor_snapshots
-- ============================================================================

ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_torque_actual_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_torque_actual_r;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_torque_actual_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_torque_actual_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_axle_speed_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_axle_speed_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_axle_speed_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_state_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_state_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_state_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_stator_temp_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_stator_temp_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_stator_temp_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_heatsink_t_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_heatsink_t_r;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_heatsink_t_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_heatsink_t_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_inverter_t_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_inverter_t_r;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_inverter_t_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_inverter_t_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_motor_current_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_motor_current_r;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_motor_current_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_motor_current_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_v_bat_f;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_v_bat_r;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_v_bat_rel;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_v_bat_rer;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS di_slave_torque_cmd;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS hvil;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS brake_pedal_pos;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS cruise_set_speed;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS drive_rail;

-- ============================================================================
-- Remove added columns from climate_snapshots
-- ============================================================================

ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS hvac_ac_enabled;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS hvac_auto_mode;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS hvac_fan_status;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS hvac_steering_wheel_heat_auto;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS hvac_steering_wheel_heat_level;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS climate_keeper_mode;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS cabin_overheat_protection_temp_limit;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS defrost_for_preconditioning;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS seat_heater_left;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS seat_heater_right;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS seat_heater_rear_left;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS seat_heater_rear_center;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS seat_heater_rear_right;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS seat_vent_enabled;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS climate_seat_cooling_front_left;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS climate_seat_cooling_front_right;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS auto_seat_climate_left;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS auto_seat_climate_right;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS rear_defrost_enabled;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS rear_display_hvac_enabled;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS wiper_heat_enabled;

-- ============================================================================
-- Remove added columns from security_events
-- ============================================================================

ALTER TABLE security_events DROP COLUMN IF EXISTS homelink_device_count;
ALTER TABLE security_events DROP COLUMN IF EXISTS guest_mode_mobile_access_state;
ALTER TABLE security_events DROP COLUMN IF EXISTS driver_seat_occupied;
ALTER TABLE security_events DROP COLUMN IF EXISTS center_display;
ALTER TABLE security_events DROP COLUMN IF EXISTS speed_limit_mode;
ALTER TABLE security_events DROP COLUMN IF EXISTS valet_mode_enabled;
ALTER TABLE security_events DROP COLUMN IF EXISTS service_mode;
ALTER TABLE security_events DROP COLUMN IF EXISTS current_limit_mph;
ALTER TABLE security_events DROP COLUMN IF EXISTS paired_phone_key_count;
ALTER TABLE security_events DROP COLUMN IF EXISTS lights_hazards_active;
ALTER TABLE security_events DROP COLUMN IF EXISTS lights_high_beams;
ALTER TABLE security_events DROP COLUMN IF EXISTS lights_turn_signal;
ALTER TABLE security_events DROP COLUMN IF EXISTS tonneau_position;
ALTER TABLE security_events DROP COLUMN IF EXISTS tonneau_open_percent;
ALTER TABLE security_events DROP COLUMN IF EXISTS tonneau_tent_mode;
ALTER TABLE security_events DROP COLUMN IF EXISTS driver_seat_belt;
ALTER TABLE security_events DROP COLUMN IF EXISTS passenger_seat_belt;

-- ============================================================================
-- Remove TPMS extended columns from tire_pressure_snapshots
-- ============================================================================

ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS hard_warnings;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS soft_warnings;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_fl;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_fr;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_rl;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_rr;

COMMIT;
