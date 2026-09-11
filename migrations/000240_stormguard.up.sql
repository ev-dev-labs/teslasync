-- Storm Guardian: per-vehicle severe-weather auto-prep config plus an
-- append-only assessment/action log.

CREATE TABLE IF NOT EXISTS stormguard_config (
    vehicle_id bigint PRIMARY KEY REFERENCES vehicles (id) ON DELETE CASCADE,
    enabled    boolean NOT NULL DEFAULT false,
    lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    target_soc integer NOT NULL DEFAULT 90 CHECK (target_soc BETWEEN 50 AND 100),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stormguard_events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id bigint NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    level      text NOT NULL CHECK (level IN ('none', 'watch', 'warning')),
    reason     text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
    acted      boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stormguard_events_vehicle
    ON stormguard_events (vehicle_id, created_at DESC);
