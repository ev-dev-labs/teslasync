-- =========================================================================
-- 18 — alert_rules
-- ADR-001: typed rule storage (no jsonb rule_def).
-- =========================================================================

CREATE TABLE alert_rules (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name          text             NOT NULL,
  description   text,
  enabled       boolean          NOT NULL DEFAULT true,
  vehicle_id    bigint           REFERENCES vehicles(id) ON DELETE CASCADE,
  signal_name   text             NOT NULL,
  op            text             NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','changed','between','outside')),
  value_num     double precision,
  value_text    text,
  value_bool    boolean,
  value_min     double precision,
  value_max     double precision,
  severity      text             NOT NULL DEFAULT 'warn'
                                 CHECK (severity IN ('info','warn','critical')),
  cooldown_min  integer          NOT NULL DEFAULT 60 CHECK (cooldown_min >= 0),
  created_at    timestamptz      NOT NULL DEFAULT now(),
  updated_at    timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE  alert_rules IS 'Typed alert rule storage. ADR-001: no jsonb rule_def column.';
COMMENT ON COLUMN alert_rules.vehicle_id IS 'NULL = applies to all vehicles owned by the user.';
COMMENT ON COLUMN alert_rules.cooldown_min IS 'Minimum minutes between consecutive alerts from this rule, regardless of signal value.';

CREATE TRIGGER alert_rules_set_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = true;
CREATE INDEX idx_alert_rules_signal  ON alert_rules (signal_name);
