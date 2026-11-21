CREATE TABLE smart_trip_packet_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    paused boolean NOT NULL,
    next_check_at timestamptz CHECK (NOT paused OR next_check_at IS NULL),
    lease_until timestamptz,
    checked_through timestamptz,
    reviewed_through timestamptz,
    dismissed_through timestamptz,
    notified_through timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX idx_smart_trip_packet_plans_due ON smart_trip_packet_plans (next_check_at, id)
    WHERE next_check_at IS NOT NULL;

CREATE TABLE smart_trip_packet_entries (
    plan_id bigint NOT NULL REFERENCES smart_trip_packet_plans(id) ON DELETE CASCADE,
    drive_id bigint NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('business', 'commute', 'personal')),
    PRIMARY KEY (plan_id, drive_id)
);

CREATE TABLE smart_trip_packet_receipts (
    plan_id bigint NOT NULL,
    drive_id bigint NOT NULL,
    receipt_day date NOT NULL,
    reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 120),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000),
    PRIMARY KEY (plan_id, drive_id, receipt_day, reference, currency),
    FOREIGN KEY (plan_id, drive_id) REFERENCES smart_trip_packet_entries(plan_id, drive_id) ON DELETE CASCADE
);
