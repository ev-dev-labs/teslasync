-- Migration 028 down: Remove extended live_state columns

-- Revert climate_snapshots column width
ALTER TABLE climate_snapshots
    ALTER COLUMN cabin_overheat_protection_temp_limit TYPE VARCHAR(20);

-- Remove location_snapshot additions
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS route_last_updated;
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS current_lat;
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS current_lon;

-- Remove all columns added to vehicle_live_state
-- (grouped for readability; order doesn't matter for DROP)

-- Security / Vehicle Access
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS guest_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS guest_mode_mobile_access;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS homelink_nearby;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS homelink_device_count;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS driver_seat_occupied;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS speed_limit_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS valet_mode_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS service_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS current_limit_mph;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS paired_phone_key_count;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lights_hazards_active;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lights_high_beams;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lights_turn_signal;

-- Software Update
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS sw_update_version;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS sw_update_download_pct;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS sw_update_install_pct;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS sw_update_expected_duration;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS sw_update_scheduled_start;

-- State Machine
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS last_gear;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS last_speed_time;

-- Vehicle Configuration
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS trim;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS roof_color;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS efficiency_package;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS rear_seat_heaters;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS sunroof_installed;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS europe_vehicle;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS right_hand_drive;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS remote_start_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS offroad_lightbar_present;

-- Charging Extended
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS ac_charging_energy_in;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_current_request;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_current_request_max;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_enable_request;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_port;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_port_cold_weather_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_port_door_open;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charge_port_latch;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS charger_phases;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS dc_charging_energy_in;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS estimated_hours_to_charge_termination;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS fast_charger_present;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS fast_charger_type;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS scheduled_charging_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS scheduled_charging_pending;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS scheduled_charging_start_time;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS scheduled_departure_time;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS supercharger_session_trip_planner;

-- Motor / Powertrain
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS brake_pedal_pos;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS dcdc_enable;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_axle_speed_f;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_axle_speed_r;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_axle_speed_rel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_axle_speed_rer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_heatsink_tf;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_heatsink_tr;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_heatsink_trel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_heatsink_trer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_inverter_tf;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_inverter_tr;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_inverter_trel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_inverter_trer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_motor_current_f;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_motor_current_r;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_motor_current_rel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_motor_current_rer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_slave_torque_cmd;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_state_f;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_state_r;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_state_rel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_state_rer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_stator_temp_f;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_stator_temp_r;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_stator_temp_rel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_stator_temp_rer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_torque_actual_f;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_torque_actual_r;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_torque_actual_rel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_torque_actual_rer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_torquemotor;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_v_bat_f;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_v_bat_r;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_v_bat_rel;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS di_v_bat_rer;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS drive_rail;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvil;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS cruise_set_speed;

-- Climate Extended
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_fan_speed;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS auto_seat_climate_left;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS auto_seat_climate_right;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS cabin_overheat_protection_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS cabin_overheat_protection_temperature_limit;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS climate_keeper_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS climate_seat_cooling_front_left;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS climate_seat_cooling_front_right;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS defrost_for_preconditioning;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS defrost_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_ac_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_auto_mode;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_fan_status;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_left_temperature_request;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_right_temperature_request;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_steering_wheel_heat_auto;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS hvac_steering_wheel_heat_level;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS not_enough_power_to_heat;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS preconditioning_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS rear_defrost_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS rear_display_hvac_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS seat_heater_left;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS seat_heater_right;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS seat_heater_rear_left;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS seat_heater_rear_center;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS seat_heater_rear_right;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS seat_vent_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS wiper_heat_enabled;

-- Safety / ADAS
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS automatic_blind_spot_camera;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS automatic_emergency_braking_off;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS blind_spot_collision_warning_chime;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS cruise_follow_distance;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS driver_seat_belt;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS emergency_lane_departure_avoidance;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS forward_collision_warning;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lane_departure_avoidance;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS passenger_seat_belt;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS speed_limit_warning;

-- Media
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_audio_volume;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_audio_volume_increment;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_audio_volume_max;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_now_playing_album;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_now_playing_artist;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_now_playing_duration;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_now_playing_elapsed;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_now_playing_station;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_now_playing_title;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_playback_source;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS media_playback_status;

-- Navigation
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS destination_name;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS expected_energy_percent_at_trip_arrival;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS miles_since_reset;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS miles_to_arrival;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS minutes_to_arrival;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS route_last_updated;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS route_line;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS route_traffic_minutes_delay;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS self_driving_miles_since_reset;

-- TPMS Extended
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tpms_hard_warnings;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tpms_last_seen_pressure_time_fl;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tpms_last_seen_pressure_time_fr;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tpms_last_seen_pressure_time_rl;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tpms_last_seen_pressure_time_rr;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tpms_soft_warnings;

-- Battery / BMS
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS bms_state;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS battery_heater_on;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS bms_fullchargecomplete;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS brick_voltage_max;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS brick_voltage_min;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS isolation_resistance;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lifetime_energy_gained_regen;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lifetime_energy_used;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lifetime_energy_used_drive;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS module_temp_max;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS module_temp_min;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS num_brick_voltage_max;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS num_brick_voltage_min;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS num_module_temp_max;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS num_module_temp_min;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS pack_current;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS pack_voltage;

-- User Preferences
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS setting24_hour_time;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS setting_charge_unit;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS setting_distance_unit;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS setting_temperature_unit;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS setting_tire_pressure_unit;

-- Powershare
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS powershare_hours_left;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS powershare_instantaneous_power_kw;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS powershare_status;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS powershare_stop_reason;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS powershare_type;

-- Other
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS lateral_acceleration;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS located_at_favorite;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS located_at_home;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS located_at_work;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS longitudinal_acceleration;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS pin_to_drive_enabled;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tonneau_open_percent;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tonneau_position;
ALTER TABLE vehicle_live_state DROP COLUMN IF EXISTS tonneau_tent_mode;
