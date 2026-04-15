-- Enhanced command tracking with FSM lifecycle
CREATE TABLE IF NOT EXISTS command_executions (
    id                BIGSERIAL PRIMARY KEY,
    vehicle_id        BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    command_type      VARCHAR(50) NOT NULL,
    parameters        JSONB,
    state             VARCHAR(20) NOT NULL DEFAULT 'queued',
    requested_by      VARCHAR(100),
    wake_retry_count  INT NOT NULL DEFAULT 0,
    retry_count       INT NOT NULL DEFAULT 0,
    max_retries       INT NOT NULL DEFAULT 3,
    last_error        JSONB,
    tesla_response    JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    wake_sent_at      TIMESTAMPTZ,
    wake_confirmed_at TIMESTAMPTZ,
    command_sent_at   TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmd_exec_vehicle ON command_executions (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_exec_state ON command_executions (state) WHERE state NOT IN ('succeeded', 'gave_up');
