CREATE TABLE IF NOT EXISTS smart_recall_watches (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject         text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id      bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    model           text NOT NULL CHECK (model IN ('Roadster','Model S','Model X','Model 3','Model Y','Cybertruck')),
    model_year      integer NOT NULL CHECK (model_year BETWEEN 2008 AND 2100),
    next_check_at   timestamptz NOT NULL,
    lease_until     timestamptz,
    last_success    timestamptz,
    last_failed     boolean NOT NULL DEFAULT false,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_recall_watches_due ON smart_recall_watches (next_check_at, id);

CREATE TABLE IF NOT EXISTS smart_recall_campaign_matches (
    watch_id      bigint NOT NULL REFERENCES smart_recall_watches(id) ON DELETE CASCADE,
    campaign      text NOT NULL CHECK (campaign ~ '^[0-9]{2}V[0-9]{6}$'),
    component     text NOT NULL CHECK (char_length(component) BETWEEN 1 AND 200),
    remedy        text NOT NULL CHECK (char_length(remedy) BETWEEN 1 AND 4000),
    reported_at   timestamptz NOT NULL,
    checked_at    timestamptz NOT NULL,
    fresh_until   timestamptz NOT NULL CHECK (fresh_until > checked_at),
    current_match boolean NOT NULL DEFAULT true,
    PRIMARY KEY (watch_id, campaign),
    CHECK (reported_at <= checked_at)
);
