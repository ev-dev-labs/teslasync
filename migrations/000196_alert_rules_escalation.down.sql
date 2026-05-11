-- 000196_alert_rules_escalation.down.sql
-- Reverse of 000196_alert_rules_escalation.up.sql.

ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_escalation_severity_higher_chk;
ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_escalation_repeat_only_chk;
ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_escalation_pair_chk;

ALTER TABLE alert_rules
    DROP COLUMN IF EXISTS escalation_severity,
    DROP COLUMN IF EXISTS escalation_after_min;
