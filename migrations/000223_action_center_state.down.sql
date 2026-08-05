BEGIN;

DROP INDEX IF EXISTS action_center_action_audit_subject_recommendation_idx;
DROP INDEX IF EXISTS action_center_states_snoozed_until_idx;
DROP INDEX IF EXISTS action_center_states_subject_state_idx;
DROP TABLE IF EXISTS action_center_action_audit;
DROP TABLE IF EXISTS action_center_states;

COMMIT;
