-- 000196_alert_rules_escalation.up.sql
-- Phase-49 / Slice 0009 — Decision D8.
--
-- Two-tier severity for repeat-mode alert rules. A rule that holds at
-- its declared severity may automatically escalate to a strictly higher
-- severity if the condition stays unresolved for `escalation_after_min`
-- minutes. Both columns are nullable: NULL = no escalation (legacy
-- behaviour) and the engine returns the rule's base severity unchanged.
--
-- Constraints:
--   1. Mutual presence: both columns NULL together or both set together
--      (alert_rules_escalation_pair_chk). Prevents a half-configured
--      escalation that the engine could not act on.
--   2. Repeat-only (alert_rules_escalation_repeat_only_chk). Once-mode
--      rules latch on a single fire and never re-evaluate, so an
--      escalation timer would never get a chance to run.
--   3. Severity ordering (alert_rules_escalation_severity_higher_chk).
--      The escalated severity MUST be strictly higher than the rule's
--      base severity (info < warn < critical). This is enforced at the
--      DB level so a misconfigured handler can never write a downgrade.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards re-runs.

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS escalation_after_min INTEGER NULL
        CHECK (escalation_after_min IS NULL OR escalation_after_min > 0),
    ADD COLUMN IF NOT EXISTS escalation_severity TEXT NULL
        CHECK (escalation_severity IS NULL
            OR escalation_severity IN ('info', 'warn', 'critical'));

ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_escalation_pair_chk;
ALTER TABLE alert_rules
    ADD CONSTRAINT alert_rules_escalation_pair_chk
    CHECK ((escalation_after_min IS NULL) = (escalation_severity IS NULL));

ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_escalation_repeat_only_chk;
ALTER TABLE alert_rules
    ADD CONSTRAINT alert_rules_escalation_repeat_only_chk
    CHECK (escalation_after_min IS NULL OR trigger_mode = 'repeat');

-- Severity ordering: info < warn < critical. We can't use the textual
-- column directly in a comparison expression because TEXT collation
-- would make 'critical' < 'info' < 'warn' alphabetically. Encode the
-- ordering in a CASE expression and require strict inequality.
ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_escalation_severity_higher_chk;
ALTER TABLE alert_rules
    ADD CONSTRAINT alert_rules_escalation_severity_higher_chk
    CHECK (
        escalation_severity IS NULL
        OR (
            CASE escalation_severity
                WHEN 'info'     THEN 1
                WHEN 'warn'     THEN 2
                WHEN 'critical' THEN 3
            END
            >
            CASE severity
                WHEN 'info'     THEN 1
                WHEN 'warn'     THEN 2
                WHEN 'critical' THEN 3
                ELSE 0
            END
        )
    );

COMMENT ON COLUMN alert_rules.escalation_after_min IS
    'For repeat-mode rules: after this many minutes of continuously unresolved condition, fire at escalation_severity instead of the rule''s base severity. NULL = no escalation. Phase-49 / Slice 0009.';
COMMENT ON COLUMN alert_rules.escalation_severity IS
    'Severity to fire at after escalation_after_min has elapsed. MUST be strictly higher than the rule''s base severity (info < warn < critical). NULL when escalation is disabled. Phase-49 / Slice 0009.';
