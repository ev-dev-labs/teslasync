-- =========================================================================
-- 14 — automations parent + steps + kind enum + tags
-- ADR-004 class table inheritance. Per-kind child tables follow in 15-17.
-- =========================================================================

CREATE TYPE automation_step_kind AS ENUM (
  'trigger_signal', 'trigger_geofence', 'trigger_schedule', 'trigger_event',
  'condition_signal', 'condition_time_window', 'condition_geofence', 'condition_other_automation',
  'action_command', 'action_notify', 'action_set_setting', 'action_call_automation'
);

COMMENT ON TYPE automation_step_kind IS
  'Closed enum. Adding a new kind requires a coordinated migration: ALTER TYPE … ADD VALUE plus a new child table.';

CREATE TABLE automations (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name            text             NOT NULL,
  description     text,
  enabled         boolean          NOT NULL DEFAULT true,
  vehicle_id      bigint           REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE  automations IS 'Class-table-inheritance root per ADR-004. vehicle_id NULL = applies to all vehicles.';
COMMENT ON COLUMN automations.vehicle_id IS 'NULL means the rule applies to every vehicle owned by the user.';

CREATE TRIGGER automations_set_updated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_automations_enabled  ON automations (enabled) WHERE enabled = true;
CREATE INDEX idx_automations_vehicle  ON automations (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE TABLE automation_steps (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id bigint               NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  step_order    integer              NOT NULL,
  kind          automation_step_kind NOT NULL,
  UNIQUE (automation_id, step_order)
);

COMMENT ON TABLE  automation_steps IS 'Discriminator. Each step has exactly one matching child row in the kind-specific table.';
COMMENT ON COLUMN automation_steps.kind IS 'ENUM. Determines which child table holds the typed fields for this step.';

CREATE INDEX idx_automation_steps_kind ON automation_steps (kind);

CREATE TABLE automation_tags (
  automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  tag           text   NOT NULL,
  PRIMARY KEY (automation_id, tag)
);

COMMENT ON TABLE automation_tags IS 'Normalized tag list. No text[] shortcut.';

CREATE INDEX idx_automation_tags_tag ON automation_tags (tag);
