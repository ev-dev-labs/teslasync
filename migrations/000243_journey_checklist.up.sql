-- Journey Autopilot slice 3: checklist runs.
--
-- Each run snapshots one ready-to-roll evaluation for a session: the
-- item verdicts as JSONB plus when the check ran. Runs are append-only
-- so the trip debrief can show the vehicle's pre-trip state.

CREATE TABLE IF NOT EXISTS journey_checklist_runs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id bigint NOT NULL REFERENCES journey_sessions (id) ON DELETE CASCADE,
    run_at     timestamptz NOT NULL DEFAULT now(),
    items      jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_journey_checklist_runs_session
    ON journey_checklist_runs (session_id, run_at DESC);
