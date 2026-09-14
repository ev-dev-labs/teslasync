-- Journey Autopilot slice 4: live trail checkpoints.
--
-- Append-only position/state snapshots while a session is active (or
-- paused). The companion posts check-ins; the server backfills any
-- missing fields from live telemetry so a bare ping still snapshots
-- the car. Unique on (session_id, recorded_at) for idempotent retry.

CREATE TABLE IF NOT EXISTS journey_checkpoints (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id  bigint NOT NULL REFERENCES journey_sessions (id) ON DELETE CASCADE,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    soc_pct     double precision CHECK (soc_pct IS NULL OR (soc_pct BETWEEN 0 AND 100)),
    odometer_m  double precision CHECK (odometer_m IS NULL OR odometer_m >= 0),
    UNIQUE (session_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_journey_checkpoints_session
    ON journey_checkpoints (session_id, recorded_at DESC);
