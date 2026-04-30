-- =========================================================================
-- 15 — automation step condition children (4 tables)
-- ADR-004 CTI children for the 'condition_*' step kinds.
-- =========================================================================

CREATE TABLE automation_step_condition_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text             NOT NULL,
  op         text             NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','between','in')),
  value_text text,
  value_num  double precision,
  value_bool boolean,
  value_min  double precision,
  value_max  double precision,
  CHECK (op <> 'between' OR (value_min IS NOT NULL AND value_max IS NOT NULL))
);
COMMENT ON TABLE automation_step_condition_signal IS
  'CTI child for condition_signal kind. value_min/value_max only used when op = between.';

CREATE TABLE automation_step_condition_time_window (
  step_id      bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  timezone     text NOT NULL DEFAULT 'UTC',
  days_of_week smallint[] NOT NULL
                CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
COMMENT ON TABLE  automation_step_condition_time_window IS
  'CTI child for condition_time_window. days_of_week: 0=Sun..6=Sat. Typed array, NOT jsonb.';
COMMENT ON COLUMN automation_step_condition_time_window.days_of_week IS
  'Subset of {0..6}. Empty array = always (no day filter).';

CREATE TABLE automation_step_condition_geofence (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  -- FK to places(id) added in prompt 23 (forward dependency)
  place_id bigint NOT NULL,
  state    text   NOT NULL CHECK (state IN ('inside','outside','dwell'))
);
COMMENT ON TABLE  automation_step_condition_geofence IS
  'CTI child for condition_geofence. FK to places(id) deferred to prompt 23.';

CREATE TABLE automation_step_condition_other_automation (
  step_id          bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  other_automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE RESTRICT,
  state            text NOT NULL CHECK (state IN ('enabled','disabled','recently_triggered'))
);
COMMENT ON TABLE automation_step_condition_other_automation IS
  'CTI child for condition_other_automation. RESTRICT delete: cannot delete an automation referenced by another.';

CREATE INDEX idx_cond_signal_signal ON automation_step_condition_signal (signal);
CREATE INDEX idx_cond_geofence_place ON automation_step_condition_geofence (place_id);
