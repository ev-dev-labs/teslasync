CREATE TABLE smart_shared_trip_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_subject text COLLATE "C" NOT NULL
        CHECK (octet_length(owner_subject) BETWEEN 1 AND 256),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    departure_at timestamptz NOT NULL,
    cancelled_at timestamptz,
    UNIQUE (id, revision)
);

CREATE TABLE smart_shared_trip_entries (
    trip_id bigint NOT NULL,
    trip_revision bigint NOT NULL CHECK (trip_revision > 0),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    subject text COLLATE "C" NOT NULL
        CHECK (octet_length(subject) BETWEEN 1 AND 256),
    entry_version bigint NOT NULL DEFAULT 1 CHECK (entry_version > 0),
    confirmed_at timestamptz,
    evidence_expires_at timestamptz,
    revoked_at timestamptz,
    trip_use_low_pct double precision,
    trip_use_high_pct double precision,
    reserve_pct double precision,
    schedule_clear boolean,
    maintenance_clear boolean,
    PRIMARY KEY (trip_id, vehicle_id),
    FOREIGN KEY (trip_id, trip_revision)
        REFERENCES smart_shared_trip_plans(id, revision)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CHECK (num_nonnulls(confirmed_at, evidence_expires_at, trip_use_low_pct,
        trip_use_high_pct, reserve_pct, schedule_clear, maintenance_clear) IN (0, 7)),
    CHECK (confirmed_at IS NULL OR (
        revoked_at IS NULL AND evidence_expires_at > confirmed_at
        AND evidence_expires_at <= confirmed_at + interval '24 hours'
        AND trip_use_low_pct BETWEEN 0 AND 100
        AND trip_use_high_pct BETWEEN trip_use_low_pct AND 100
        AND reserve_pct BETWEEN 0 AND 100
    ))
);

CREATE INDEX smart_shared_trip_plans_owner_active_idx
    ON smart_shared_trip_plans (owner_subject, departure_at, id)
    WHERE cancelled_at IS NULL;
CREATE INDEX smart_shared_trip_entries_subject_active_idx
    ON smart_shared_trip_entries (subject, trip_id, vehicle_id)
    WHERE revoked_at IS NULL;
