-- Phase-46 / Prompt 19 — per-user notification quiet hours / Do-Not-Disturb.
--
-- A row represents a single repeating do-not-deliver window for a user.
-- Multiple windows per user are supported (e.g. nightly sleep + lunch).
-- The dispatcher checks each enabled window and defers delivery when the
-- current local time falls inside any window AND the notification's
-- severity is NOT in that window's bypass list.
--
-- A separate replay loop in the notification worker promotes deferred
-- log rows back to "sent" once their causing window ends.
--
-- The user_id column carries the ForwardAuth subject (e.g. email or
-- username) of the user who owns the window. In open-mode installs
-- (no ForwardAuth header configured) the API uses the empty string,
-- which is still a valid scope key so single-user installs work without
-- any additional configuration.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_quiet_hours (
  id                bigserial   PRIMARY KEY,
  user_id           text        NOT NULL,
  enabled           boolean     NOT NULL DEFAULT true,
  start_local       time        NOT NULL,
  end_local         time        NOT NULL,
  timezone          text        NOT NULL,
  weekdays          integer     NOT NULL DEFAULT 127,
  bypass_severities text[]      NOT NULL DEFAULT ARRAY['critical']::text[],
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_quiet_hours_weekdays_chk
    CHECK (weekdays >= 0 AND weekdays <= 127)
);

COMMENT ON TABLE notification_quiet_hours IS
  'Per-user notification Do-Not-Disturb windows. The dispatcher defers '
  'delivery for matching severities and the worker replays them when '
  'the window ends.';
COMMENT ON COLUMN notification_quiet_hours.user_id IS
  'ForwardAuth subject of the user who owns the window. Empty string '
  'in open-mode installs (single-user).';
COMMENT ON COLUMN notification_quiet_hours.start_local IS
  'Local-time start of the window (in the configured timezone). Inclusive.';
COMMENT ON COLUMN notification_quiet_hours.end_local IS
  'Local-time end of the window. Exclusive. May wrap past midnight: '
  'when end_local <= start_local the window covers '
  '[start_local..24:00) ∪ [00:00..end_local).';
COMMENT ON COLUMN notification_quiet_hours.timezone IS
  'IANA timezone (e.g. "America/Los_Angeles") interpreted via Go tzdata. '
  'Validated server-side on insert/update.';
COMMENT ON COLUMN notification_quiet_hours.weekdays IS
  'Bitmask of days the window applies to. Sun=1, Mon=2, Tue=4, Wed=8, '
  'Thu=16, Fri=32, Sat=64. 127 = every day.';
COMMENT ON COLUMN notification_quiet_hours.bypass_severities IS
  'Severities that ALWAYS deliver regardless of this window. Defaults '
  'to {critical}. Allowed values: info | warn | critical.';

CREATE INDEX IF NOT EXISTS idx_notification_quiet_hours_user
  ON notification_quiet_hours (user_id, enabled);

-- notification_logs.severity is added so deferred rows know which severity
-- they were enqueued with. The dispatcher writes this column when emitting
-- the deferred row; the replay loop re-evaluates the window against it.
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS severity text;
COMMENT ON COLUMN notification_logs.severity IS
  'Wire severity (info | warn | critical) the dispatcher saw when this '
  'row was enqueued. NULL for legacy rows captured before phase-46/19.';

CREATE INDEX IF NOT EXISTS idx_notification_logs_status_created
  ON notification_logs (status, created_at)
  WHERE status = 'deferred_dnd';

COMMIT;
