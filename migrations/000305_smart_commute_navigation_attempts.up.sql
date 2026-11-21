CREATE TABLE smart_commute_navigation_attempts (
    routine_id   bigint PRIMARY KEY REFERENCES smart_commute_routines(id) ON DELETE CASCADE,
    departure_at timestamptz NOT NULL,
    attempted_at timestamptz NOT NULL CHECK (attempted_at < departure_at),
    outcome      text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'delivery_unknown', 'expired', 'not_sent'))
);

COMMENT ON TABLE smart_commute_navigation_attempts IS
    'Latest explicit navigation attempt per routine; fences replay without retaining destinations or provider bodies.';
