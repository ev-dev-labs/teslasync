-- =========================================================================
-- 19 — notification_channels + per-kind typed config + close FK from 17
-- ADR-001: per-kind typed config tables, no jsonb config blob.
-- =========================================================================

CREATE TYPE notification_channel_kind AS ENUM (
  'discord','slack','telegram','email','webhook','ntfy','pushover'
);

CREATE TABLE notification_channels (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text                       NOT NULL,
  kind        notification_channel_kind  NOT NULL,
  enabled     boolean                    NOT NULL DEFAULT true,
  created_at  timestamptz                NOT NULL DEFAULT now(),
  updated_at  timestamptz                NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_channels IS 'Parent table for typed notification channel config.';

CREATE TRIGGER notification_channels_set_updated_at
  BEFORE UPDATE ON notification_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_channels_enabled ON notification_channels (enabled) WHERE enabled = true;

-- ============= Per-kind typed config children =============

CREATE TABLE notification_channel_discord (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,                -- encrypted at rest by internal/crypto
  username    text,
  avatar_url  text
);

CREATE TABLE notification_channel_slack (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,                -- encrypted at rest
  channel     text,
  username    text
);

CREATE TABLE notification_channel_telegram (
  channel_id bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  bot_token  text NOT NULL,                 -- encrypted at rest
  chat_id    text NOT NULL
);

CREATE TABLE notification_channel_email (
  channel_id    bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  smtp_host     text NOT NULL,
  smtp_port     integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_username text,
  smtp_password text,                       -- encrypted at rest
  from_address  text NOT NULL,
  to_addresses  text NOT NULL,              -- comma-separated; runtime parses
  use_tls       boolean NOT NULL DEFAULT true
);

CREATE TABLE notification_channel_webhook (
  channel_id   bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  url          text NOT NULL,
  http_method  text NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST','PUT','PATCH')),
  bearer_token text                         -- encrypted at rest
);

CREATE TABLE notification_channel_ntfy (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  server_url  text NOT NULL DEFAULT 'https://ntfy.sh',
  topic       text NOT NULL,
  auth_token  text                          -- encrypted at rest
);

CREATE TABLE notification_channel_pushover (
  channel_id bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  user_key   text NOT NULL,                 -- encrypted at rest
  api_token  text NOT NULL                  -- encrypted at rest
);

-- ============= Close deferred FK from prompt 17 =============

ALTER TABLE automation_step_action_notify
  ADD CONSTRAINT action_notify_channel_fk
  FOREIGN KEY (channel_id) REFERENCES notification_channels(id) ON DELETE RESTRICT;
