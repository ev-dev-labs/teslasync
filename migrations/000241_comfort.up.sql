-- Cabin Comfort Autopilot: calendar-aware preconditioning config plus
-- an append-only run log (also the idempotency record per event UID).

CREATE TABLE IF NOT EXISTS comfort_config (
    vehicle_id   bigint PRIMARY KEY REFERENCES vehicles (id) ON DELETE CASCADE,
    enabled      boolean NOT NULL DEFAULT false,
    target_temp_c double precision NOT NULL DEFAULT 21 CHECK (target_temp_c BETWEEN 15 AND 28),
    lead_minutes integer NOT NULL DEFAULT 20 CHECK (lead_minutes BETWEEN 5 AND 120),
    ics_url      text NOT NULL DEFAULT '' CHECK (char_length(ics_url) <= 2000),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comfort_runs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id bigint NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    event_uid  text NOT NULL CHECK (char_length(event_uid) <= 500),
    event_title text NOT NULL DEFAULT '' CHECK (char_length(event_title) <= 300),
    starts_at  timestamptz NOT NULL,
    acted_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vehicle_id, event_uid)
);
CREATE INDEX IF NOT EXISTS idx_comfort_runs_vehicle
    ON comfort_runs (vehicle_id, acted_at DESC);
