-- Data-repair case management: durable anomaly lifecycle with reversible
-- quarantine. Implements the case-based worklist that surfaces diagnosed
-- session anomalies, tracks operator review/resolution, supports undo (restore
-- from quarantine), and prevents duplicate active cases via a deterministic
-- fingerprint.
--
-- Design decisions:
--   1. CHECK constraints (not PG enum types) for kind/status — matches repo
--      convention established by 000211 (dlq_replay_audit_result_check).
--   2. JSONB is used ONLY in data_repair_quarantine.original_row — that column
--      stores an opaque versioned recovery payload of complete session rows,
--      which are wide and schema-version-dependent. This is the explicit
--      "truly dynamic/opaque payload" exception documented in
--      .github/instructions/data-modeling.instructions.md.
--   3. All timestamps are timestamptz, UTC. No unit-bearing numeric fields
--      (this domain is timestamps + classification + text), so no unit suffix
--      columns are needed.
--   4. The tracked fingerprint constraint keeps dismissed false positives
--      suppressed until explicitly reopened, while allowing recurrence after
--      applied/restored/quarantined/resolved outcomes to create a new case.
--   5. Length constraints enforce sanity limits on free-text fields to prevent
--      storage abuse without being unreasonably restrictive.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. data_repair_cases
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_repair_cases (
    id              BIGSERIAL       PRIMARY KEY,
    fingerprint     TEXT            NOT NULL
        CONSTRAINT data_repair_cases_fingerprint_len
            CHECK (fingerprint ~ '^[0-9a-f]{64}$'),

    kind            TEXT            NOT NULL
        CONSTRAINT data_repair_cases_kind_check
            CHECK (kind IN ('drive', 'charging')),

    session_id      BIGINT          NOT NULL,
    related_session_id BIGINT,
    vehicle_id      BIGINT          NOT NULL,

    rule            TEXT            NOT NULL,
    confidence      TEXT            NOT NULL
        CONSTRAINT data_repair_cases_confidence_check
            CHECK (confidence IN ('high', 'medium')),

    status          TEXT            NOT NULL DEFAULT 'open'
        CONSTRAINT data_repair_cases_status_check
            CHECK (status IN ('open', 'in_review', 'applied', 'dismissed', 'restored', 'quarantined', 'resolved')),

    suggested_ended_at  TIMESTAMPTZ,

    -- Evidence preserved at discovery time (stable typed fields).
    evidence_started_at         TIMESTAMPTZ NOT NULL,
    evidence_stored_ended_at    TIMESTAMPTZ,
    evidence_contradiction_ts   TIMESTAMPTZ NOT NULL,
    evidence_contradiction_src  TEXT        NOT NULL,
    evidence_contradiction_field TEXT       NOT NULL,
    evidence_contradiction_value TEXT       NOT NULL,
    evidence_last_in_session_ts    TIMESTAMPTZ,
    evidence_last_in_session_src   TEXT,
    evidence_last_in_session_field TEXT,
    evidence_last_in_session_value TEXT,
    evidence_gap_s              BIGINT      NOT NULL DEFAULT 0
        CONSTRAINT data_repair_cases_evidence_gap_s_nonneg
            CHECK (evidence_gap_s >= 0),

    -- All four last-in-session evidence fields must be uniformly NULL or populated.
    CONSTRAINT data_repair_cases_last_in_session_complete
        CHECK (
            (evidence_last_in_session_ts IS NULL
             AND evidence_last_in_session_src IS NULL
             AND evidence_last_in_session_field IS NULL
             AND evidence_last_in_session_value IS NULL)
            OR
            (evidence_last_in_session_ts IS NOT NULL
             AND evidence_last_in_session_src IS NOT NULL
             AND evidence_last_in_session_field IS NOT NULL
             AND evidence_last_in_session_value IS NOT NULL)
        ),

    assigned_to     TEXT
        CONSTRAINT data_repair_cases_assigned_to_len
            CHECK (assigned_to IS NULL OR char_length(assigned_to) BETWEEN 1 AND 255),
    resolution_note TEXT
        CONSTRAINT data_repair_cases_resolution_note_len
            CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 1 AND 4000),

    -- Applicability: whether the diagnosis currently permits the Apply action.
    -- When applicable=false, blocked_reason explains why (machine token for i18n).
    applicable      BOOLEAN         NOT NULL DEFAULT false,
    blocked_reason  TEXT
        CONSTRAINT data_repair_cases_blocked_reason_len
            CHECK (blocked_reason IS NULL OR char_length(blocked_reason) BETWEEN 1 AND 500),
    -- If not applicable, the operator must see why; if applicable, no reason needed.
    CONSTRAINT data_repair_cases_applicable_blocked_consistent
        CHECK (
            (applicable AND blocked_reason IS NULL)
            OR (NOT applicable AND blocked_reason IS NOT NULL)
        ),

    first_seen_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    applied_at      TIMESTAMPTZ,
    dismissed_at    TIMESTAMPTZ,
    restored_at     TIMESTAMPTZ,
    quarantined_at  TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Worklist index: open/in_review cases per vehicle, newest first.
CREATE INDEX IF NOT EXISTS idx_data_repair_cases_worklist
    ON data_repair_cases (status, vehicle_id, last_seen_at DESC)
    WHERE status IN ('open', 'in_review');

-- Unique tracked fingerprint: only one open/in_review/dismissed case per
-- fingerprint. Dismissed false positives remain suppressed; other terminal
-- outcomes permit a genuinely recurring anomaly to create a new case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_repair_cases_active_fingerprint
    ON data_repair_cases (fingerprint)
    WHERE status IN ('open', 'in_review', 'dismissed');

-- Fast lookup by session for cross-referencing from session detail pages.
CREATE INDEX IF NOT EXISTS idx_data_repair_cases_session
    ON data_repair_cases (kind, session_id, related_session_id);

-- Confidence filter support.
CREATE INDEX IF NOT EXISTS idx_data_repair_cases_confidence
    ON data_repair_cases (confidence, last_seen_at DESC);

-- Assignment filter support.
CREATE INDEX IF NOT EXISTS idx_data_repair_cases_assigned
    ON data_repair_cases (assigned_to, last_seen_at DESC)
    WHERE assigned_to IS NOT NULL;

COMMENT ON TABLE data_repair_cases IS
    'Anomaly case lifecycle for the data-repair worklist. Each row tracks a '
    'single diagnosed session boundary anomaly through discovery → review → '
    'resolution. Cases are created by the background diagnosis scanner and '
    'resolved by operator action (apply/dismiss/restore/quarantine). A '
    'deterministic fingerprint prevents duplicate active cases.';
COMMENT ON COLUMN data_repair_cases.fingerprint IS
    'Deterministic dedupe key: SHA-256 hex of kind + session_id + rule + '
    'related_session_id. Uniqueness includes dismissed cases so acknowledged '
    'false positives stay suppressed until an operator explicitly reopens '
    'them; other terminal outcomes may re-surface as a new case.';
COMMENT ON COLUMN data_repair_cases.evidence_gap_s IS
    'Seconds between last in-session evidence and the contradicting '
    'observation. Larger gaps indicate missed signals during outages.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. data_repair_case_comments
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_repair_case_comments (
    id          BIGSERIAL       PRIMARY KEY,
    case_id     BIGINT          NOT NULL
        REFERENCES data_repair_cases (id) ON DELETE CASCADE,
    actor       TEXT            NOT NULL
        CONSTRAINT data_repair_case_comments_actor_len
            CHECK (char_length(actor) BETWEEN 1 AND 255),
    body        TEXT            NOT NULL
        CONSTRAINT data_repair_case_comments_body_len
            CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_repair_case_comments_case
    ON data_repair_case_comments (case_id, created_at ASC);

COMMENT ON TABLE data_repair_case_comments IS
    'Typed free-text comment trail on a data-repair case. Cascade-deletes '
    'with the parent case. Actor is the forward-auth subject or system.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. data_repair_scan_runs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_repair_scan_runs (
    id              BIGSERIAL       PRIMARY KEY,
    trigger         TEXT            NOT NULL
        CONSTRAINT data_repair_scan_runs_trigger_check
            CHECK (trigger IN ('manual', 'scheduled')),
    status          TEXT            NOT NULL DEFAULT 'running'
        CONSTRAINT data_repair_scan_runs_status_check
            CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    vehicle_id      BIGINT,
    initiated_by    TEXT            NOT NULL
        CONSTRAINT data_repair_scan_runs_initiated_by_len
            CHECK (char_length(initiated_by) BETWEEN 1 AND 255),
    discovered      INT             NOT NULL DEFAULT 0
        CONSTRAINT data_repair_scan_runs_discovered_nonneg
            CHECK (discovered >= 0),
    refreshed       INT             NOT NULL DEFAULT 0
        CONSTRAINT data_repair_scan_runs_refreshed_nonneg
            CHECK (refreshed >= 0),
    truncated       BOOLEAN         NOT NULL DEFAULT false,
    failure_reason  TEXT
        CONSTRAINT data_repair_scan_runs_failure_reason_len
            CHECK (failure_reason IS NULL OR char_length(failure_reason) BETWEEN 1 AND 500),
    started_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    CONSTRAINT data_repair_scan_runs_completion_consistent
        CHECK (
            (status = 'running' AND completed_at IS NULL AND failure_reason IS NULL)
            OR (status IN ('completed', 'skipped') AND completed_at IS NOT NULL AND failure_reason IS NULL)
            OR (status = 'failed' AND completed_at IS NOT NULL AND failure_reason IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_data_repair_scan_runs_completed
    ON data_repair_scan_runs (completed_at DESC)
    WHERE status = 'completed';

COMMENT ON TABLE data_repair_scan_runs IS
    'Bounded integrity-scan execution history. Records successful empty scans '
    'as well as failures/skips so operators can distinguish clean data from a '
    'scanner that has not run.';

-- The overlap detector uses ended_at as a strictly implied range bound in
-- addition to its started_at lookback. These partial indexes prevent periodic
-- scans from walking complete session history.
CREATE INDEX IF NOT EXISTS drives_vehicle_ended_repair_scan
    ON drives (vehicle_id, ended_at)
    WHERE ended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS charging_sessions_vehicle_ended_repair_scan
    ON charging_sessions (vehicle_id, ended_at)
    WHERE ended_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. data_repair_quarantine
-- ─────────────────────────────────────────────────────────────────────────────
-- JSONB exception: original_row stores the complete session row snapshot
-- (drive or charging_sessions — both are wide, schema-versioned, and opaque to
-- this table). It is a recovery payload, not a queryable projection — once
-- restored the data is re-inserted into the typed session table. This is the
-- explicit "truly dynamic/opaque payload" carve-out permitted by
-- data-modeling.instructions.md.

CREATE TABLE IF NOT EXISTS data_repair_quarantine (
    id              BIGSERIAL       PRIMARY KEY,
    case_id         BIGINT          NOT NULL
        REFERENCES data_repair_cases (id) ON DELETE RESTRICT,
    kind            TEXT            NOT NULL
        CONSTRAINT data_repair_quarantine_kind_check
            CHECK (kind IN ('drive', 'charging')),
    session_id      BIGINT          NOT NULL,
    vehicle_id      BIGINT          NOT NULL,

    -- Recovery payload: the exact original row at quarantine time.
    -- JSONB exception documented above — opaque versioned snapshot.
    original_row    JSONB           NOT NULL,
    schema_version  INT             NOT NULL DEFAULT 1
        CONSTRAINT data_repair_quarantine_schema_version_pos
            CHECK (schema_version > 0),
    checksum        TEXT            NOT NULL
        CONSTRAINT data_repair_quarantine_checksum_hex64
            CHECK (checksum ~ '^[0-9a-f]{64}$'),

    reason          TEXT            NOT NULL
        CONSTRAINT data_repair_quarantine_reason_len
            CHECK (char_length(reason) BETWEEN 1 AND 1000),
    quarantined_by  TEXT            NOT NULL
        CONSTRAINT data_repair_quarantine_quarantined_by_len
            CHECK (char_length(quarantined_by) BETWEEN 1 AND 255),
    quarantined_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    restored_by     TEXT
        CONSTRAINT data_repair_quarantine_restored_by_len
            CHECK (restored_by IS NULL OR char_length(restored_by) BETWEEN 1 AND 255),
    restored_at     TIMESTAMPTZ
);

-- Partial unique: only one ACTIVE (non-restored) quarantine per session.
-- After a restore, the same session can be quarantined again (new row),
-- preserving full quarantine history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_repair_quarantine_active_session
    ON data_repair_quarantine (kind, session_id)
    WHERE restored_at IS NULL;

-- Allow quick lookup when restoring by case.
CREATE INDEX IF NOT EXISTS idx_data_repair_quarantine_case
    ON data_repair_quarantine (case_id);

-- Keyset pagination for quarantine list UI (newest quarantine first).
CREATE INDEX IF NOT EXISTS idx_data_repair_quarantine_list
    ON data_repair_quarantine (quarantined_at DESC, id DESC);

COMMENT ON TABLE data_repair_quarantine IS
    'Reversible quarantine of session rows (drives or charging_sessions). '
    'The original_row JSONB column stores the exact pre-deletion snapshot '
    'as an opaque recovery payload — this is the documented JSONB exception '
    'for truly dynamic/opaque payloads (see data-modeling.instructions.md). '
    'On restore, the domain repo re-inserts the typed row using the snapshot.';
COMMENT ON COLUMN data_repair_quarantine.original_row IS
    'Opaque JSON snapshot of the full session row at quarantine time. '
    'Schema-versioned; the restore path must handle old versions. '
    'JSONB exception: wide session rows are schema-dependent and storing '
    'them typed would couple this table to every session schema migration.';
COMMENT ON COLUMN data_repair_quarantine.checksum IS
    'SHA-256 hex of the serialized original_row bytes at quarantine time. '
    'Verified on restore to detect storage corruption.';
COMMENT ON COLUMN data_repair_quarantine.schema_version IS
    'Version tag for the original_row layout. Incremented when the source '
    'session table schema changes in a breaking way. The restore path uses '
    'this to select the correct deserialization strategy.';

COMMIT;
