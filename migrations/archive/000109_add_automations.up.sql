-- Core automations table
CREATE TABLE IF NOT EXISTS automations (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    vehicle_id          BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,  -- NULL = all vehicles
    enabled             BOOLEAN NOT NULL DEFAULT true,

    -- Trigger
    trigger_type        TEXT NOT NULL,  -- 'cron', 'battery', 'vehicle_state', 'geofence', 'mqtt', 'webhook', 'sunrise_sunset', 'energy', 'calendar'
    trigger_config      JSONB NOT NULL DEFAULT '{}',

    -- Conditions (optional guards)
    conditions          JSONB NOT NULL DEFAULT '[]',  -- array of condition objects

    -- Actions
    actions             JSONB NOT NULL DEFAULT '[]',  -- ordered array of action objects

    -- Options
    cooldown_minutes    INTEGER NOT NULL DEFAULT 0,
    max_executions_hour INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
    stop_on_failure     BOOLEAN NOT NULL DEFAULT false,
    notify_on_run       BOOLEAN NOT NULL DEFAULT false,
    notify_on_failure   BOOLEAN NOT NULL DEFAULT true,
    seasonal_start      INTEGER,  -- month 1-12, NULL = no seasonal restriction
    seasonal_end        INTEGER,  -- month 1-12
    priority            INTEGER NOT NULL DEFAULT 50,  -- 1=highest, 100=lowest

    -- State
    last_triggered_at   TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    last_failure_at     TIMESTAMPTZ,
    execution_count     BIGINT NOT NULL DEFAULT 0,
    failure_count       BIGINT NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    auto_disabled       BOOLEAN NOT NULL DEFAULT false,
    auto_disabled_reason TEXT,

    -- Metadata
    preset_id           TEXT,  -- if created from a preset template
    tags                TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_vehicle ON automations (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations (enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations (trigger_type);

-- Execution history
CREATE TABLE IF NOT EXISTS automation_history (
    id                  BIGSERIAL PRIMARY KEY,
    automation_id       BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    automation_name     TEXT NOT NULL,
    vehicle_id          BIGINT,
    triggered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    duration_ms         INTEGER,

    -- Trigger info
    trigger_type        TEXT NOT NULL,
    trigger_snapshot    JSONB NOT NULL DEFAULT '{}',  -- what triggered it (e.g., battery_level=19)

    -- Condition evaluation
    conditions_met      BOOLEAN NOT NULL DEFAULT true,
    conditions_snapshot JSONB NOT NULL DEFAULT '[]',  -- each condition's evaluation result

    -- Action results
    actions_executed    JSONB NOT NULL DEFAULT '[]',  -- [{action, status, error, duration_ms}]
    actions_total       INTEGER NOT NULL DEFAULT 0,
    actions_succeeded   INTEGER NOT NULL DEFAULT 0,
    actions_failed      INTEGER NOT NULL DEFAULT 0,

    -- Overall status
    status              TEXT NOT NULL DEFAULT 'running',  -- running, success, partial, failed, skipped, cancelled
    error               TEXT,

    -- FSM tracking
    fsm_state           TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_history_automation ON automation_history (automation_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_history_status ON automation_history (status);
CREATE INDEX IF NOT EXISTS idx_automation_history_time ON automation_history (triggered_at DESC);

-- Automation variables (key-value store for cross-automation state)
CREATE TABLE IF NOT EXISTS automation_variables (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT NOT NULL DEFAULT '',
    vehicle_id  BIGINT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
