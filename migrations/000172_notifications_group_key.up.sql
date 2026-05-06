-- Phase-46 / Prompt 27 — notification grouping / threading.
--
-- Adds a deterministic `group_key` column to notification_logs so the
-- inbox can collapse repeated DELIVERIES of the same alert rule +
-- severity into a single threaded row. "Deliveries" here means both
-- (a) per-channel fan-out for one firing and (b) repeated firings of
-- the same rule over time — both produce one notification_logs row per
-- channel. The grouping is therefore a "thread of related deliveries"
-- view, not a cross-vehicle aggregation (rules are typically scoped to
-- a single vehicle in this codebase).
--
-- group_key derivation lives in internal/database/notification_repo.go
-- (deriveNotificationLogGroupKey): sha256(alert_id || '|' || severity)
-- in lower-hex when both are present; NULL otherwise. NULL group_keys
-- are treated as ungrouped singletons by the grouping query and are
-- NEVER threaded.
--
-- The partial index covers WHERE group_key IS NOT NULL so only the
-- threaded population pays the index cost. Singleton rows are
-- unindexed because they're served by the existing
-- (created_at DESC) read paths.

BEGIN;

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS group_key text;

COMMENT ON COLUMN notification_logs.group_key IS
  'Deterministic hash of (alert_id || severity) used to thread repeated '
  'deliveries of the same rule + severity into one inbox row. '
  'NULL = ungrouped singleton (e.g. test sends, ad-hoc notifications, '
  'or legacy rows that pre-date phase-46/27). Stored as lower-hex.';

CREATE INDEX IF NOT EXISTS idx_notification_logs_group_key
  ON notification_logs (group_key, created_at DESC)
  WHERE group_key IS NOT NULL;

COMMIT;
