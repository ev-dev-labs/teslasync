-- Phase-46 / Prompt 20 — Alert acknowledgement with optional note.
--
-- TeslaSync sources alerts from `notification_logs` joined to `alert_rules`
-- (ADR-010 Option B; see internal/api/alert_handler.go AlertHandler.List).
-- There is no separate `alert_logs` table — the prompt's "Blocked Path"
-- explicitly says: adapt the migration to the actual schema, do not create
-- a parallel table.
--
-- Schema changes:
--
-- 1. Three nullable columns on `notification_logs` carrying the latest
--    acknowledgement state. NULL means "not yet acknowledged"; a non-NULL
--    `acknowledged_at` records when, by whom, and (optionally) why.
--    The columns are written by the `/alerts/{id}/acknowledge` handler
--    and cleared by `/alerts/{id}/reopen`.
--
-- 2. A new `notification_log_events` table carrying the per-row audit
--    timeline. One row per state-changing action (acknowledged, reopened,
--    commented). The `created` synthetic entry is reconstructed from
--    `notification_logs.created_at` at read time so existing CreateLog
--    write paths don't need to change.
--
-- All existing rows remain valid: the new columns default to NULL and the
-- new table starts empty.

BEGIN;

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS acknowledged_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by      TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgement_note TEXT;

COMMENT ON COLUMN notification_logs.acknowledged_at IS
  'When the alert was acknowledged (NULL = not yet acknowledged). '
  'Cleared by /alerts/{id}/reopen.';
COMMENT ON COLUMN notification_logs.acknowledged_by IS
  'Actor (ForwardAuth subject) who acknowledged. Empty string in open-mode '
  'installs without a configured ForwardAuth header.';
COMMENT ON COLUMN notification_logs.acknowledgement_note IS
  'Optional free-text note recorded with the acknowledgement (≤1000 chars). '
  'Trimmed server-side; whitespace-only is stored as NULL.';

CREATE TABLE IF NOT EXISTS notification_log_events (
  id                  BIGSERIAL   PRIMARY KEY,
  notification_log_id BIGINT      NOT NULL
    REFERENCES notification_logs(id) ON DELETE CASCADE,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor               TEXT,
  kind                TEXT        NOT NULL,
  note                TEXT,
  metadata            JSONB,
  CONSTRAINT notification_log_events_kind_chk
    CHECK (kind IN ('acknowledged', 'reopened', 'commented'))
);

COMMENT ON TABLE notification_log_events IS
  'Per-alert audit timeline (Phase-46 / Prompt 20). One row per '
  'state-changing action: acknowledged, reopened, commented. The '
  '"created" entry is synthesised from notification_logs.created_at '
  'at read time, not persisted, so existing CreateLog call sites '
  'do not need to change.';
COMMENT ON COLUMN notification_log_events.actor IS
  'ForwardAuth subject of the acting user. Empty string in open-mode installs.';
COMMENT ON COLUMN notification_log_events.note IS
  'Free-text note attached to the event (≤1000 chars). Required for '
  'commented; optional for acknowledged.';
COMMENT ON COLUMN notification_log_events.metadata IS
  'Reserved for future structured payloads (e.g. snooze reason, escalation '
  'channel). NULL today.';

CREATE INDEX IF NOT EXISTS idx_notification_log_events_log
  ON notification_log_events (notification_log_id, occurred_at);

COMMIT;
