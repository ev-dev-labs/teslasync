-- Journey Autopilot slice 1: trip sessions + versioned plans.
--
-- A journey_session is one planned-or-live trip. Status machine
-- (planned -> active -> paused -> completed/aborted) is enforced in the
-- API; the CHECK below only bounds the value domain. Plans are
-- versioned rows so every replan keeps its predecessor for diffing.

CREATE TABLE IF NOT EXISTS journey_sessions (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id    bigint NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    origin_name   text NOT NULL DEFAULT '' CHECK (char_length(origin_name) <= 300),
    origin_lat    double precision,
    origin_lng    double precision,
    dest_name     text NOT NULL DEFAULT '' CHECK (char_length(dest_name) <= 300),
    dest_lat      double precision,
    dest_lng      double precision,
    status        text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'active', 'paused', 'completed', 'aborted')),
    plan_version  integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    ended_at      timestamptz,
    CHECK (origin_lat IS NULL OR (origin_lat BETWEEN -90 AND 90)),
    CHECK (origin_lng IS NULL OR (origin_lng BETWEEN -180 AND 180)),
    CHECK (dest_lat IS NULL OR (dest_lat BETWEEN -90 AND 90)),
    CHECK (dest_lng IS NULL OR (dest_lng BETWEEN -180 AND 180))
);
CREATE INDEX IF NOT EXISTS idx_journey_sessions_vehicle
    ON journey_sessions (vehicle_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS journey_plan_versions (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id  bigint NOT NULL REFERENCES journey_sessions (id) ON DELETE CASCADE,
    version     integer NOT NULL CHECK (version > 0),
    plan        jsonb NOT NULL DEFAULT '{}',
    note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, version)
);
CREATE INDEX IF NOT EXISTS idx_journey_plan_versions_session
    ON journey_plan_versions (session_id, version DESC);
