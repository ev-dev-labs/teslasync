-- Notification channels configuration
CREATE TABLE IF NOT EXISTS notification_channels (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('discord', 'email', 'slack', 'telegram', 'webhook', 'ntfy', 'pushover')),
    config          JSONB NOT NULL DEFAULT '{}',
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification delivery log
CREATE TABLE IF NOT EXISTS notification_logs (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    alert_id        BIGINT REFERENCES alerts(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    message         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_channel ON notification_logs(channel_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON notification_logs(created_at DESC);

-- Chatbot conversation history
CREATE TABLE IF NOT EXISTS chatbot_messages (
    id              BIGSERIAL PRIMARY KEY,
    session_id      TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_session ON chatbot_messages(session_id, created_at);
