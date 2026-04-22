-- =========================================================================
-- 16 — automation_actions (only JSONB carve-out in the schema)
-- ADR-001 + ADR-004: command_params is intentionally jsonb because Tesla
-- command parameters vary per command and Tesla revises the contract
-- without coordination. The application is contractually forbidden from
-- using this column in WHERE / GROUP BY / ORDER BY (audit checks this).
-- =========================================================================

CREATE TABLE automation_actions (
  id              bigint           PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  step_id         bigint           NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  command_name    text             NOT NULL
                                   CHECK (command_name IN (
                                     -- Keep in sync with internal/tesla/client.go `commands` map
                                     -- (the frontend command name keys, not the Fleet API endpoints).
                                     -- Adding a new command requires updating this CHECK in lockstep.
                                     'actuate_frunk',
                                     'actuate_trunk',
                                     'add_charge_schedule',
                                     'add_precondition_schedule',
                                     'adjust_volume',
                                     'auto_seat_climate',
                                     'auto_steering_heat',
                                     'bioweapon_off',
                                     'bioweapon_on',
                                     'boombox_fart',
                                     'boombox_ping',
                                     'camp_mode',
                                     'cancel_software_update',
                                     'charge_max_range',
                                     'charge_port_close',
                                     'charge_port_open',
                                     'charge_standard',
                                     'charge_start',
                                     'charge_stop',
                                     'clear_pin_to_drive_admin',
                                     'climate_keeper_off',
                                     'climate_keeper_on',
                                     'climate_off',
                                     'climate_on',
                                     'close_charge_port',
                                     'close_windows',
                                     'cop_fan_only',
                                     'cop_off',
                                     'cop_on',
                                     'dog_mode',
                                     'erase_user_data',
                                     'flash',
                                     'flash_lights',
                                     'frunk',
                                     'frunk_open',
                                     'guest_mode_off',
                                     'guest_mode_on',
                                     'honk',
                                     'honk_horn',
                                     'lock',
                                     'media_next_fav',
                                     'media_next_track',
                                     'media_prev_fav',
                                     'media_prev_track',
                                     'media_toggle_playback',
                                     'media_volume_down',
                                     'navigation_gps_request',
                                     'navigation_request',
                                     'navigation_sc_request',
                                     'open_charge_port',
                                     'preconditioning_max',
                                     'preconditioning_reset',
                                     'remote_boombox',
                                     'remote_start_drive',
                                     'remove_charge_schedule',
                                     'remove_precondition_schedule',
                                     'reset_pin_to_drive_pin',
                                     'reset_valet_pin',
                                     'schedule_software_update',
                                     'seat_cooler',
                                     'seat_heater',
                                     'sentry_off',
                                     'sentry_on',
                                     'set_charge_limit',
                                     'set_charging_amps',
                                     'set_cop_temp',
                                     'set_pin_to_drive',
                                     'set_scheduled_charging',
                                     'set_scheduled_departure',
                                     'set_sentry_mode',
                                     'set_temps',
                                     'set_valet_mode',
                                     'set_vehicle_name',
                                     'speed_limit_clear_pin',
                                     'speed_limit_clear_pin_admin',
                                     'speed_limit_off',
                                     'speed_limit_on',
                                     'speed_limit_set_limit',
                                     'steering_wheel_heat',
                                     'steering_wheel_level',
                                     'sunroof_close',
                                     'sunroof_stop',
                                     'sunroof_vent',
                                     'trigger_homelink',
                                     'trunk_open',
                                     'unlock',
                                     'valet_off',
                                     'valet_on',
                                     'vent_windows',
                                     'wake',
                                     'wake_up'
                                   )),
  command_params  jsonb            NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE automation_actions IS
  'Per-step Tesla command invocation. Parented to automation_steps via step_id. '
  'One automation_steps row may be parent to exactly one of: condition, action, delay (CTI per ADR-004).';

COMMENT ON COLUMN automation_actions.command_name IS
  'Tesla command identifier (frontend name, mapped to a Fleet API endpoint by the client). '
  'Must match a key in internal/tesla/client.go `commands` map. CHECK constraint enforces a closed enumeration.';

COMMENT ON COLUMN automation_actions.command_params IS
  'JSONB carve-out per ADR-001/ADR-004 — never use in WHERE/GROUP BY/ORDER BY in production. '
  'Schema-on-read: parsed by the Tesla client adapter at command-send time. '
  'Audit query SELECT count(*) FROM information_schema.columns WHERE data_type IN (''jsonb'',''json'') '
  'must return exactly 1, and that 1 must be this column.';

-- updated_at maintenance trigger (shared trigger function defined in 01-vehicles.sql)
CREATE TRIGGER trg_automation_actions_set_updated_at
  BEFORE UPDATE ON automation_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_automation_actions_step_id ON automation_actions(step_id);
