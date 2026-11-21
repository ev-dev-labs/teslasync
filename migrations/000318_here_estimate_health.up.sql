CREATE TABLE here_estimate_incidents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    feed text NOT NULL CHECK (feed IN ('here_import', 'here_routes', 'here_flow')),
    operator_subject text COLLATE "C" NOT NULL CHECK (octet_length(operator_subject) <= 512),
    started_at timestamptz NOT NULL,
    resolved_at timestamptz CHECK (resolved_at > started_at)
);

CREATE UNIQUE INDEX here_estimate_incidents_open_feed_idx
    ON here_estimate_incidents (feed) WHERE resolved_at IS NULL;
CREATE INDEX here_estimate_incidents_recipient_idx
    ON here_estimate_incidents (operator_subject, started_at DESC, id DESC)
    WHERE operator_subject <> '';

CREATE TABLE here_estimate_health (
    feed text PRIMARY KEY CHECK (feed IN ('here_import', 'here_routes', 'here_flow')),
    incident_id bigint UNIQUE REFERENCES here_estimate_incidents(id) ON DELETE RESTRICT,
    changed_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
    last_outage_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
    next_probe_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch'
);

INSERT INTO here_estimate_health (feed) VALUES ('here_import'), ('here_routes'), ('here_flow');

CREATE FUNCTION here_estimates_usable(evidence_at timestamptz, only_feed text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT evidence_at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM here_estimate_health
        WHERE (only_feed IS NULL OR feed = only_feed)
          AND (incident_id IS NOT NULL OR evidence_at <= last_outage_at)
    )
$$;
