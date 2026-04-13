-- Notification delivery tracking with FSM state
CREATE TABLE IF NOT EXISTS notifications (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    alert_rule_id   BIGINT,
    type            VARCHAR(30) NOT NULL DEFAULT 'alert',
    title           VARCHAR(255) NOT NULL,
    body            TEXT,
    severity        VARCHAR(20) NOT NULL DEFAULT 'info',
    state           VARCHAR(20) NOT NULL DEFAULT 'created',
    channels        JSONB NOT NULL DEFAULT '[]',
    signals_snapshot JSONB,
    retry_count     INT NOT NULL DEFAULT 0,
    max_retries     INT NOT NULL DEFAULT 3,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at    TIMESTAMPTZ,
    next_retry_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_vehicle ON notifications (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_state ON notifications (state) WHERE state NOT IN ('delivered', 'dead');
CREATE INDEX IF NOT EXISTS idx_notifications_retry ON notifications (next_retry_at) WHERE state = 'failed';

-- Alert cooldown state (per rule per vehicle)
CREATE TABLE IF NOT EXISTS alert_cooldown_state (
    alert_rule_id   BIGINT NOT NULL,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    state           VARCHAR(20) NOT NULL DEFAULT 'armed',
    last_fired_at   TIMESTAMPTZ,
    fire_count_hour INT NOT NULL DEFAULT 0,
    suppressed_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (alert_rule_id, vehicle_id)
);
