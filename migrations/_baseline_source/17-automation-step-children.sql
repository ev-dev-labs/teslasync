-- =========================================================================
-- 17 — remaining automation step CTI children
-- ADR-004 — completes the CTI tree for all step kinds except action_command
-- (action_command is prompt 16, the sole JSONB carve-out).
-- =========================================================================

-- ============= TRIGGER children =============

CREATE TABLE automation_step_trigger_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text NOT NULL,
  op         text NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','changed','crossed_above','crossed_below')),
  value_text text,
  value_num  double precision,
  value_bool boolean
);
COMMENT ON TABLE automation_step_trigger_signal IS 'CTI child for trigger_signal kind.';
CREATE INDEX idx_trig_signal_signal ON automation_step_trigger_signal (signal);

CREATE TABLE automation_step_trigger_geofence (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  place_id bigint NOT NULL,                   -- FK added in prompt 23 (forward dep)
  event    text NOT NULL CHECK (event IN ('enter','exit','dwell'))
);
COMMENT ON TABLE automation_step_trigger_geofence IS 'CTI child for trigger_geofence. FK to places(id) deferred to prompt 23.';
CREATE INDEX idx_trig_geofence_place ON automation_step_trigger_geofence (place_id);

CREATE TABLE automation_step_trigger_schedule (
  step_id   bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  cron_expr text NOT NULL,
  timezone  text NOT NULL DEFAULT 'UTC'
);
COMMENT ON TABLE automation_step_trigger_schedule IS 'CTI child for trigger_schedule kind. cron_expr validated by Go cron parser at write time.';

CREATE TABLE automation_step_trigger_event (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  event_type text NOT NULL
              CHECK (event_type IN ('drive_start','drive_end','charge_start','charge_end','sleep_start','sleep_end','online','offline','sentry_alert'))
);
COMMENT ON TABLE automation_step_trigger_event IS 'CTI child for trigger_event kind. Closed event vocabulary.';

-- ============= ACTION children (excluding action_command which is prompt 16) =============

CREATE TABLE automation_step_action_notify (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  channel_id bigint NOT NULL,                 -- FK to notification_channels(id) deferred to prompt 19
  template   text NOT NULL
);
COMMENT ON TABLE automation_step_action_notify IS
  'CTI child for action_notify. template = mustache-style string, NOT json. FK to notification_channels deferred to prompt 19.';

CREATE TABLE automation_step_action_set_setting (
  step_id     bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  value_text  text,
  value_num   double precision,
  value_bool  boolean
);
COMMENT ON TABLE automation_step_action_set_setting IS
  'CTI child for action_set_setting. setting_key matches a row in settings table; runtime validates type matches value_*.';

CREATE TABLE automation_step_action_call_automation (
  step_id            bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  target_automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE RESTRICT
);
COMMENT ON TABLE automation_step_action_call_automation IS
  'CTI child for action_call_automation. RESTRICT — cannot delete an automation called by another.';
