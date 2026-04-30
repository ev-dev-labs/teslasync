-- Guard Mode: anti-theft monitoring configuration and event log

CREATE TABLE vehicle_guard_config (
    vehicle_id      BIGINT PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    home_geofence_id BIGINT REFERENCES geofences(id) ON DELETE SET NULL,
    sensitivity     TEXT NOT NULL DEFAULT 'medium' CHECK (sensitivity IN ('low', 'medium', 'high')),
    auto_panic      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guard_events (
    id                BIGSERIAL PRIMARY KEY,
    vehicle_id        BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    event_type        TEXT NOT NULL CHECK (event_type IN ('vehicle_moved', 'unauthorized_unlock', 'unauthorized_drive', 'sentry_triggered', 'manual_panic', 'test_alert')),
    latitude          DOUBLE PRECISION,
    longitude         DOUBLE PRECISION,
    speed             DOUBLE PRECISION,
    details           JSONB,
    notified_channels TEXT[],
    acknowledged      BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guard_events_vehicle_created ON guard_events(vehicle_id, created_at DESC);
