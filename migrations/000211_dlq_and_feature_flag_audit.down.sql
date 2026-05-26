-- Reverse of 000211_dlq_and_feature_flag_audit.up.sql
DROP INDEX IF EXISTS feature_flag_changes_flag_key_idx;
DROP INDEX IF EXISTS feature_flag_changes_changed_at_idx;
DROP TABLE IF EXISTS feature_flag_changes;

DROP INDEX IF EXISTS dlq_replay_audit_actor_idx;
DROP INDEX IF EXISTS dlq_replay_audit_replayed_at_idx;
DROP TABLE IF EXISTS dlq_replay_audit;
