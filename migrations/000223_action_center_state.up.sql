BEGIN;

CREATE TABLE IF NOT EXISTS action_center_states (
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    recommendation_id     text        NOT NULL
                                      CHECK (recommendation_id ~ '^ac_[0-9a-f]{24}$'),
    fingerprint           text        NOT NULL
                                      CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    state                 text        NOT NULL
                                      CHECK (state IN ('open', 'acknowledged', 'snoozed', 'dismissed')),
    snoozed_until         timestamptz,
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, recommendation_id),
    CONSTRAINT action_center_snooze_consistent CHECK (
        (state = 'snoozed' AND snoozed_until IS NOT NULL) OR
        (state <> 'snoozed' AND snoozed_until IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS action_center_action_audit (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    recommendation_id     text        NOT NULL
                                      CHECK (recommendation_id ~ '^ac_[0-9a-f]{24}$'),
    fingerprint           text        NOT NULL
                                      CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    action                text        NOT NULL
                                      CHECK (action IN ('acknowledge', 'snooze', 'dismiss', 'restore')),
    from_state            text        NOT NULL
                                      CHECK (from_state IN ('open', 'acknowledged', 'snoozed', 'dismissed')),
    to_state              text        NOT NULL
                                      CHECK (to_state IN ('open', 'acknowledged', 'snoozed', 'dismissed')),
    outcome               text        NOT NULL DEFAULT 'applied'
                                      CHECK (outcome IN ('applied')),
    state_version         integer     NOT NULL CHECK (state_version > 0),
    occurred_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_center_states_subject_state_idx
    ON action_center_states (subject, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS action_center_states_snoozed_until_idx
    ON action_center_states (snoozed_until)
    WHERE state = 'snoozed';
CREATE INDEX IF NOT EXISTS action_center_action_audit_subject_recommendation_idx
    ON action_center_action_audit (subject, recommendation_id, occurred_at DESC, id DESC);

COMMENT ON TABLE action_center_states IS
    'Subject-scoped Action Center acknowledgement, snooze, and dismissal state. Open-mode installs use one local subject.';
COMMENT ON TABLE action_center_action_audit IS
    'Immutable audit history for confirmation-gated Action Center state transitions.';

COMMIT;
