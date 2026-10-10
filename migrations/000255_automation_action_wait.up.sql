ALTER TYPE automation_step_kind ADD VALUE IF NOT EXISTS 'action_wait';

CREATE TABLE IF NOT EXISTS automation_step_action_wait (
    step_id bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
    duration_s integer NOT NULL CHECK (duration_s BETWEEN 1 AND 3600)
);

COMMENT ON COLUMN automation_step_action_wait.duration_s IS
    'Cancellable sequential delay in integer SI seconds (1 through 3600).';

ALTER TABLE automation_actions DROP CONSTRAINT automation_actions_command_name_check;
ALTER TABLE automation_actions ADD CONSTRAINT automation_actions_command_name_check
CHECK (command_name IN (
    'actuate_frunk', 'actuate_trunk', 'add_charge_schedule', 'add_precondition_schedule',
    'adjust_volume', 'auto_seat_climate', 'auto_steering_heat', 'bioweapon_off', 'bioweapon_on',
    'boombox_fart', 'boombox_ping', 'camp_mode', 'cancel_software_update',
    'charge_max_range', 'charge_port_close', 'charge_port_open', 'charge_standard',
    'charge_start', 'charge_stop', 'clear_pin_to_drive_admin', 'climate_keeper_off',
    'climate_keeper_on', 'climate_off', 'climate_on', 'close_charge_port', 'close_windows',
    'cop_fan_only', 'cop_off', 'cop_on', 'dog_mode', 'erase_user_data', 'flash', 'flash_lights',
    'frunk', 'frunk_open', 'guest_mode_off', 'guest_mode_on', 'honk', 'honk_horn', 'lock',
    'media_next_fav', 'media_next_track', 'media_prev_fav', 'media_prev_track',
    'media_toggle_playback', 'media_volume_down', 'navigation_gps_request',
    'navigation_request', 'navigation_sc_request', 'open_charge_port',
    'preconditioning_max', 'preconditioning_reset', 'remote_boombox', 'remote_start_drive',
    'remove_charge_schedule', 'remove_precondition_schedule', 'reset_pin_to_drive_pin',
    'reset_valet_pin', 'schedule_software_update', 'seat_cooler', 'seat_heater',
    'sentry_off', 'sentry_on', 'set_charge_limit', 'set_charging_amps', 'set_cop_temp',
    'set_pin_to_drive', 'set_scheduled_charging', 'set_scheduled_departure',
    'set_sentry_mode', 'set_temps', 'set_valet_mode', 'set_vehicle_name',
    'speed_limit_clear_pin', 'speed_limit_clear_pin_admin', 'speed_limit_off',
    'speed_limit_on', 'speed_limit_set_limit', 'steering_wheel_heat', 'steering_wheel_level',
    'sunroof_close', 'sunroof_stop', 'sunroof_vent', 'trigger_homelink', 'trunk_open',
    'unlock', 'valet_off', 'valet_on', 'vent_windows', 'wake', 'wake_up',
    'cabin_overheat_protection_on', 'hvac_on'
)) NOT VALID;
ALTER TABLE automation_actions VALIDATE CONSTRAINT automation_actions_command_name_check;
