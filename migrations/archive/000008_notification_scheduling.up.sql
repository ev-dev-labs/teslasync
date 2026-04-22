-- Notification scheduling: allows users to schedule notifications for future delivery
CREATE TABLE IF NOT EXISTS notification_schedules (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    message         TEXT NOT NULL,
    cron_expr       TEXT,               -- cron expression for recurring (e.g., "0 8 * * *")
    scheduled_at    TIMESTAMPTZ,        -- one-time scheduled delivery
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_next ON notification_schedules(next_run_at)
    WHERE enabled = true;

-- Notification preferences: per-event-type enable/disable per channel
CREATE TABLE IF NOT EXISTS notification_preferences (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,       -- drive.started, charge.completed, alert.triggered, etc.
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_prefs_event ON notification_preferences(event_type);

-- Notification analytics: delivery metrics per channel
CREATE TABLE IF NOT EXISTS notification_metrics (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    date            DATE NOT NULL DEFAULT CURRENT_DATE,
    total_sent      INTEGER NOT NULL DEFAULT 0,
    total_failed    INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (channel_id, date)
);

CREATE INDEX IF NOT EXISTS idx_notification_metrics_date ON notification_metrics(date DESC);

-- Add scheduled_at to notification_logs for tracking scheduled deliveries
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
