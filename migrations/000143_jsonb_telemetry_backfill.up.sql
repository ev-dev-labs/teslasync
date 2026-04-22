-- Phase 2: Backfill signals JSONB from existing typed columns.
-- jsonb_strip_nulls drops keys whose value is NULL so we don't bloat rows
-- with explicit nulls. Only rows with empty signals are updated so this
-- migration is idempotent.

-- charging_telemetry has 52 keys (104 args). Postgres limits jsonb_build_object
-- to 100 args, so we split into two halves and concatenate with ||.
UPDATE charging_telemetry SET signals = jsonb_strip_nulls(
    jsonb_build_object(
        'soc', soc,
        'detailed_charge_state', detailed_charge_state,
        'charge_limit_soc', charge_limit_soc,
        'charge_amps', charge_amps,
        'charge_current_request', charge_current_request,
        'charge_current_request_max', charge_current_request_max,
        'charge_enable_request', charge_enable_request,
        'charger_phases', charger_phases,
        'dc_charging_energy_in', dc_charging_energy_in,
        'ac_charging_power', ac_charging_power,
        'ac_charging_energy_in', ac_charging_energy_in,
        'energy_remaining', energy_remaining,
        'est_battery_range', est_battery_range,
        'ideal_battery_range', ideal_battery_range,
        'rated_range', rated_range,
        'pack_voltage', pack_voltage,
        'pack_current', pack_current,
        'charge_port', charge_port,
        'charge_port_door_open', charge_port_door_open,
        'charge_port_latch', charge_port_latch,
        'charge_port_cold_weather_mode', charge_port_cold_weather_mode,
        'charging_cable_type', charging_cable_type,
        'fast_charger_present', fast_charger_present,
        'fast_charger_type', fast_charger_type,
        'estimated_hours_to_charge', estimated_hours_to_charge,
        'scheduled_charging_mode', scheduled_charging_mode
    )
    || jsonb_build_object(
        'scheduled_charging_pending', scheduled_charging_pending,
        'preconditioning_enabled', preconditioning_enabled,
        'brick_voltage_max', brick_voltage_max,
        'brick_voltage_min', brick_voltage_min,
        'num_brick_voltage_max', num_brick_voltage_max,
        'num_brick_voltage_min', num_brick_voltage_min,
        'module_temp_max', module_temp_max,
        'module_temp_min', module_temp_min,
        'num_module_temp_max', num_module_temp_max,
        'num_module_temp_min', num_module_temp_min,
        'battery_heater_on', battery_heater_on,
        'not_enough_power_to_heat', not_enough_power_to_heat,
        'bms_state', bms_state,
        'bms_fullcharge_complete', bms_fullcharge_complete,
        'dcdc_enable', dcdc_enable,
        'isolation_resistance', isolation_resistance,
        'lifetime_energy_used', lifetime_energy_used,
        'supercharger_session_trip_planner', supercharger_session_trip_planner,
        'powershare_status', powershare_status,
        'powershare_type', powershare_type,
        'powershare_stop_reason', powershare_stop_reason,
        'powershare_hours_left', powershare_hours_left,
        'powershare_power_kw', powershare_power_kw,
        'scheduled_charging_start_time', scheduled_charging_start_time,
        'scheduled_departure_time', scheduled_departure_time,
        'expected_energy_pct_at_arrival', expected_energy_pct_at_arrival
    )
) WHERE signals = '{}'::jsonb;

UPDATE climate_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'hvac_power', hvac_power,
    'hvac_left_temp_request', hvac_left_temp_request,
    'hvac_right_temp_request', hvac_right_temp_request,
    'cabin_overheat_mode', cabin_overheat_mode,
    'defrost_mode', defrost_mode,
    'battery_heater_on', battery_heater_on,
    'hvac_fan_status', hvac_fan_status,
    'hvac_steering_wheel_heat_auto', hvac_steering_wheel_heat_auto,
    'hvac_steering_wheel_heat_level', hvac_steering_wheel_heat_level,
    'climate_keeper_mode', climate_keeper_mode,
    'cabin_overheat_protection_temp_limit', cabin_overheat_protection_temp_limit,
    'defrost_for_preconditioning', defrost_for_preconditioning,
    'seat_heater_left', seat_heater_left,
    'seat_heater_right', seat_heater_right,
    'seat_heater_rear_left', seat_heater_rear_left,
    'seat_heater_rear_center', seat_heater_rear_center,
    'seat_heater_rear_right', seat_heater_rear_right,
    'seat_vent_enabled', seat_vent_enabled,
    'climate_seat_cooling_front_left', climate_seat_cooling_front_left,
    'climate_seat_cooling_front_right', climate_seat_cooling_front_right,
    'auto_seat_climate_left', auto_seat_climate_left,
    'auto_seat_climate_right', auto_seat_climate_right,
    'rear_defrost_enabled', rear_defrost_enabled,
    'rear_display_hvac_enabled', rear_display_hvac_enabled,
    'wiper_heat_enabled', wiper_heat_enabled
)) WHERE signals = '{}'::jsonb;

UPDATE security_events SET signals = jsonb_strip_nulls(jsonb_build_object(
    'fd_window', fd_window,
    'fp_window', fp_window,
    'rd_window', rd_window,
    'rp_window', rp_window,
    'homelink_nearby', homelink_nearby,
    'guest_mode', guest_mode,
    'homelink_device_count', homelink_device_count,
    'guest_mode_mobile_access_state', guest_mode_mobile_access_state,
    'center_display', center_display,
    'speed_limit_mode', speed_limit_mode,
    'valet_mode_enabled', valet_mode_enabled,
    'service_mode', service_mode,
    'current_limit_mph', current_limit_mph,
    'paired_phone_key_count', paired_phone_key_count,
    'lights_hazards_active', lights_hazards_active,
    'lights_high_beams', lights_high_beams,
    'lights_turn_signal', lights_turn_signal,
    'tonneau_position', tonneau_position,
    'tonneau_open_percent', tonneau_open_percent,
    'tonneau_tent_mode', tonneau_tent_mode,
    'driver_seat_belt', driver_seat_belt,
    'passenger_seat_belt', passenger_seat_belt
)) WHERE signals = '{}'::jsonb;

UPDATE motor_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'di_torque', di_torque,
    'di_axle_speed', di_axle_speed,
    'di_stator_temp', di_stator_temp,
    'pedal_position', pedal_position,
    'brake_pedal', brake_pedal,
    'lateral_accel', lateral_accel,
    'longitudinal_accel', longitudinal_accel,
    'di_torque_actual_f', di_torque_actual_f,
    'di_torque_actual_r', di_torque_actual_r,
    'di_torque_actual_rel', di_torque_actual_rel,
    'di_torque_actual_rer', di_torque_actual_rer,
    'di_axle_speed_f', di_axle_speed_f,
    'di_axle_speed_rel', di_axle_speed_rel,
    'di_axle_speed_rer', di_axle_speed_rer,
    'di_state_f', di_state_f,
    'di_state_rel', di_state_rel,
    'di_state_rer', di_state_rer,
    'di_stator_temp_f', di_stator_temp_f,
    'di_stator_temp_rel', di_stator_temp_rel,
    'di_stator_temp_rer', di_stator_temp_rer,
    'di_heatsink_t_f', di_heatsink_t_f,
    'di_heatsink_t_r', di_heatsink_t_r,
    'di_heatsink_t_rel', di_heatsink_t_rel,
    'di_heatsink_t_rer', di_heatsink_t_rer,
    'di_inverter_t_f', di_inverter_t_f,
    'di_inverter_t_r', di_inverter_t_r,
    'di_inverter_t_rel', di_inverter_t_rel,
    'di_inverter_t_rer', di_inverter_t_rer,
    'di_motor_current_f', di_motor_current_f,
    'di_motor_current_r', di_motor_current_r,
    'di_motor_current_rel', di_motor_current_rel,
    'di_motor_current_rer', di_motor_current_rer,
    'di_v_bat_f', di_v_bat_f,
    'di_v_bat_r', di_v_bat_r,
    'di_v_bat_rel', di_v_bat_rel,
    'di_v_bat_rer', di_v_bat_rer,
    'di_slave_torque_cmd', di_slave_torque_cmd,
    'hvil', hvil,
    'brake_pedal_pos', brake_pedal_pos,
    'cruise_set_speed', cruise_set_speed,
    'drive_rail', drive_rail,
    'lifetime_energy_gained_regen', lifetime_energy_gained_regen,
    'lifetime_energy_used_drive', lifetime_energy_used_drive
)) WHERE signals = '{}'::jsonb;

UPDATE tire_pressure_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'tpms_hard_warnings', tpms_hard_warnings,
    'tpms_soft_warnings', tpms_soft_warnings,
    'last_seen_time_fl', last_seen_time_fl,
    'last_seen_time_fr', last_seen_time_fr,
    'last_seen_time_rl', last_seen_time_rl,
    'last_seen_time_rr', last_seen_time_rr
)) WHERE signals = '{}'::jsonb;

UPDATE media_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'now_playing_title', now_playing_title,
    'now_playing_artist', now_playing_artist,
    'now_playing_album', now_playing_album,
    'now_playing_station', now_playing_station,
    'now_playing_duration', now_playing_duration,
    'now_playing_elapsed', now_playing_elapsed,
    'playback_source', playback_source,
    'audio_volume_max', audio_volume_max,
    'audio_volume_increment', audio_volume_increment
)) WHERE signals = '{}'::jsonb;

UPDATE safety_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'automatic_blind_spot_camera', automatic_blind_spot_camera,
    'automatic_emergency_braking_off', automatic_emergency_braking_off,
    'blind_spot_collision_warning', blind_spot_collision_warning,
    'cruise_follow_distance', cruise_follow_distance,
    'emergency_lane_departure_avoidance', emergency_lane_departure_avoidance,
    'forward_collision_warning', forward_collision_warning,
    'lane_departure_avoidance', lane_departure_avoidance,
    'speed_limit_warning', speed_limit_warning
)) WHERE signals = '{}'::jsonb;

UPDATE vehicle_config_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'trim', trim,
    'exterior_color', exterior_color,
    'roof_color', roof_color,
    'wheel_type', wheel_type,
    'rear_seat_heaters', rear_seat_heaters,
    'sunroof_installed', sunroof_installed,
    'efficiency_package', efficiency_package,
    'europe_vehicle', europe_vehicle,
    'right_hand_drive', right_hand_drive,
    'remote_start_enabled', remote_start_enabled,
    'charge_port', charge_port,
    'offroad_lightbar_present', offroad_lightbar_present,
    'software_update_version', software_update_version,
    'software_update_download_pct', software_update_download_pct,
    'software_update_install_pct', software_update_install_pct,
    'software_update_expected_duration', software_update_expected_duration,
    'software_update_scheduled_start', software_update_scheduled_start
)) WHERE signals = '{}'::jsonb;

UPDATE user_preference_snapshots SET signals = jsonb_strip_nulls(jsonb_build_object(
    'setting_24hr_time', setting_24hr_time,
    'setting_charge_unit', setting_charge_unit,
    'setting_tire_pressure_unit', setting_tire_pressure_unit
)) WHERE signals = '{}'::jsonb;
