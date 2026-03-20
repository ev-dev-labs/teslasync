-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
    type        VARCHAR(50) NOT NULL DEFAULT 'custom',
    severity    VARCHAR(20) NOT NULL DEFAULT 'info',
    title       VARCHAR(500) NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_vehicle ON alerts (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts (is_read, created_at DESC);

-- Alert rules table
CREATE TABLE IF NOT EXISTS alert_rules (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(50) NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    threshold   DOUBLE PRECISION NOT NULL DEFAULT 0,
    vehicle_id  BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default alert rules
INSERT INTO alert_rules (name, type, enabled, threshold) VALUES
    ('Low Battery Alert', 'battery_low', true, 20),
    ('Battery Full Alert', 'battery_full', true, 95),
    ('Sentry Mode Event', 'sentry', true, 0),
    ('Speed Alert', 'speed', false, 120),
    ('Geofence Alert', 'geofence', true, 0),
    ('Software Update', 'software', true, 0)
ON CONFLICT DO NOTHING;

-- Command log table
CREATE TABLE IF NOT EXISTS command_logs (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    command     VARCHAR(100) NOT NULL,
    params      TEXT NOT NULL DEFAULT '',
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    error       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_command_logs_vehicle ON command_logs (vehicle_id, created_at DESC);

-- Battery snapshots table (for battery health tracking)
CREATE TABLE IF NOT EXISTS battery_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    health_score    DOUBLE PRECISION NOT NULL DEFAULT 100,
    capacity_kwh    DOUBLE PRECISION NOT NULL DEFAULT 0,
    degradation_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    est_range_km    DOUBLE PRECISION NOT NULL DEFAULT 0,
    cycle_count     INTEGER NOT NULL DEFAULT 0,
    avg_cell_temp_c DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battery_snapshots_vehicle ON battery_snapshots (vehicle_id, created_at DESC);
