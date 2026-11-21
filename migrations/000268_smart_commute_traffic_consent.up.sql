CREATE TABLE smart_commute_traffic_consent (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routine_id     bigint NOT NULL UNIQUE REFERENCES smart_commute_routines(id) ON DELETE CASCADE,
    latitudes      double precision[] NOT NULL,
    longitudes     double precision[] NOT NULL,
    lead_s         integer NOT NULL CHECK (lead_s BETWEEN 300 AND 3600),
    min_savings_s  integer NOT NULL CHECK (min_savings_s BETWEEN 60 AND 3600),
    check_at       timestamptz NOT NULL,
    departure_at   timestamptz NOT NULL,
    consented_at   timestamptz NOT NULL,
    CHECK (cardinality(latitudes) BETWEEN 3 AND 200 AND cardinality(latitudes) = cardinality(longitudes)),
    CHECK (check_at = departure_at - lead_s * INTERVAL '1 second')
);

CREATE INDEX smart_commute_traffic_consent_due_idx
    ON smart_commute_traffic_consent (check_at, id);

COMMENT ON TABLE smart_commute_traffic_consent IS
    'Explicit consent to send only the reviewed representative route coordinates to HERE. Never log the trace.';

CREATE TABLE smart_commute_traffic_occurrences (
    routine_id    bigint PRIMARY KEY REFERENCES smart_commute_routines(id) ON DELETE CASCADE,
    departure_at  timestamptz NOT NULL,
    skipped       boolean NOT NULL DEFAULT false
);

CREATE TABLE smart_commute_traffic_decisions (
    consent_id           bigint PRIMARY KEY REFERENCES smart_commute_traffic_consent(id) ON DELETE CASCADE,
    departure_at         timestamptz NOT NULL,
    settings_updated_at  timestamptz NOT NULL,
    usual_s              integer NOT NULL CHECK (usual_s BETWEEN 1 AND 10800),
    alternative_s        integer NOT NULL CHECK (alternative_s BETWEEN 1 AND usual_s - 1),
    observed_at          timestamptz NOT NULL,
    expires_at           timestamptz NOT NULL CHECK (expires_at > observed_at AND expires_at <= departure_at)
);
