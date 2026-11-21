CREATE TABLE IF NOT EXISTS smart_service_cases (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject    text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    version    bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    opened_at  timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_service_cases_recent ON smart_service_cases (subject, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS smart_service_case_evidence (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id     bigint NOT NULL REFERENCES smart_service_cases(id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('warning','condition','firmware','recorded_work')),
    observed_at timestamptz NOT NULL,
    detail      text NOT NULL CHECK (char_length(detail) BETWEEN 1 AND 600)
);

CREATE INDEX IF NOT EXISTS idx_smart_service_case_evidence_time ON smart_service_case_evidence (case_id, observed_at, id);
