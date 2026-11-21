CREATE TABLE smart_shared_charger_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    authorized_by text COLLATE "C" NOT NULL CHECK (octet_length(authorized_by) BETWEEN 1 AND 256),
    authorized_at timestamptz NOT NULL,
    place_id bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at timestamptz NOT NULL,
    vehicle_a_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    subject_a text COLLATE "C" NOT NULL CHECK (octet_length(subject_a) BETWEEN 1 AND 256),
    vehicle_b_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    subject_b text COLLATE "C" NOT NULL CHECK (octet_length(subject_b) BETWEEN 1 AND 256),
    reminder_vehicle_id bigint,
    expires_at timestamptz NOT NULL CHECK (expires_at > authorized_at),
    revoked_at timestamptz,
    UNIQUE (id, revision),
    CHECK (vehicle_a_id <> vehicle_b_id),
    CHECK (reminder_vehicle_id IN (vehicle_a_id, vehicle_b_id))
);

CREATE TABLE smart_shared_charger_confirmations (
    plan_id bigint NOT NULL,
    plan_revision bigint NOT NULL,
    position smallint NOT NULL CHECK (position IN (1, 2)),
    available_at timestamptz NOT NULL,
    departure_at timestamptz NOT NULL,
    energy_needed_wh double precision NOT NULL
        CHECK (energy_needed_wh >= 0 AND energy_needed_wh < 'Infinity'::double precision),
    conservative_power_w double precision NOT NULL
        CHECK (conservative_power_w > 0 AND conservative_power_w < 'Infinity'::double precision),
    already_plugged boolean NOT NULL,
    confirmed_at timestamptz NOT NULL,
    accept_reminder boolean NOT NULL,
    PRIMARY KEY (plan_id, plan_revision, position),
    FOREIGN KEY (plan_id, plan_revision)
        REFERENCES smart_shared_charger_plans (id, revision) ON DELETE CASCADE,
    CHECK (available_at < departure_at AND confirmed_at < departure_at)
);

CREATE TABLE smart_shared_charger_swaps (
    plan_id bigint PRIMARY KEY,
    plan_revision bigint NOT NULL,
    swap_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > swap_at),
    published_at timestamptz,
    FOREIGN KEY (plan_id, plan_revision)
        REFERENCES smart_shared_charger_plans (id, revision) ON DELETE CASCADE,
    CHECK (published_at IS NULL OR (published_at >= swap_at AND published_at < expires_at))
);

CREATE INDEX smart_shared_charger_swaps_due_idx
    ON smart_shared_charger_swaps (swap_at, plan_id) WHERE published_at IS NULL;
CREATE INDEX smart_shared_charger_plans_expiry_idx
    ON smart_shared_charger_plans (expires_at, id);
CREATE INDEX smart_shared_charger_plans_place_idx
    ON smart_shared_charger_plans (place_id, place_updated_at, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX smart_shared_charger_plans_owner_idx
    ON smart_shared_charger_plans (authorized_by, expires_at, id) WHERE revoked_at IS NULL;
CREATE INDEX smart_shared_charger_plans_subject_a_idx
    ON smart_shared_charger_plans (subject_a, expires_at, id) WHERE revoked_at IS NULL;
CREATE INDEX smart_shared_charger_plans_subject_b_idx
    ON smart_shared_charger_plans (subject_b, expires_at, id) WHERE revoked_at IS NULL;
