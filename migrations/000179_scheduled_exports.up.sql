-- Phase-46 / Prompt 65 — Scheduled / recurring exports.
--
-- Materialises every user-configured recurring export. The export
-- worker's tick loop polls this table once a minute, picks rows whose
-- next_run_at has elapsed (FOR UPDATE SKIP LOCKED so multiple worker
-- replicas never double-fire), enqueues a one-shot export job per
-- row, and writes the next_run_at back from the row's cron expression.
--
-- Ownership
-- ---------
-- owner_subject FKs auth_subjects(subject) (Phase-46 / Prompt 57). In
-- open mode (no FORWARD_AUTH_HEADER) no rows can be created — the
-- handler 401s on missing identity rather than planting a NULL-owner
-- row. ON DELETE CASCADE keeps the table tidy when a subject is
-- removed from auth_subjects.
--
-- Reuse with Phase-46 / Prompt 62
-- -------------------------------
-- columns_json mirrors the column allowlist contract from prompt 62.
-- NULL = "every column" (legacy behaviour); a non-empty array is
-- validated by the worker against the published catalog before each
-- run so a catalog rename surfaces as a row-level last_status='failed'
-- + last_error rather than a silent column drop.
--
-- Delivery
-- --------
-- delivery is a JSONB envelope `{kind:..., target:...}` rather than
-- two fixed columns so we can extend the kind set (S3, Drive, …) in a
-- future migration without rewriting the table. Today only download,
-- email, and webhook are accepted; the worker rejects unknown kinds
-- when it processes a due row.
--
-- Schedule expression
-- -------------------
-- schedule_cron is a 5-field robfig/cron v3 standard expression. The
-- worker rejects invalid expressions at run time and parks the row
-- with last_status='failed'. The handler additionally validates at
-- create / update time so an obviously broken cron never lands.

CREATE TABLE IF NOT EXISTS scheduled_exports (
    id              BIGSERIAL    PRIMARY KEY,
    owner_subject   TEXT         NOT NULL REFERENCES auth_subjects(subject) ON DELETE CASCADE,
    name            TEXT         NOT NULL,
    export_type     TEXT         NOT NULL,
    format          TEXT         NOT NULL,
    vehicle_id      BIGINT       NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    columns_json    JSONB        NULL,
    schedule_cron   TEXT         NOT NULL,
    delivery        JSONB        NOT NULL,
    range_window    TEXT         NOT NULL DEFAULT '7d',
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    last_run_at     TIMESTAMPTZ  NULL,
    last_status     TEXT         NULL,
    last_error      TEXT         NULL,
    next_run_at     TIMESTAMPTZ  NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Whitelist enums at the DB layer so a hand-written INSERT can't
    -- bypass the handler's validation. Worker / handler still apply
    -- the same checks so the error surfaces at write time, not as a
    -- raw 23514 from pgx.
    CONSTRAINT scheduled_exports_export_type_chk
        CHECK (export_type IN ('drives', 'charging', 'trips', 'positions', 'signals')),
    CONSTRAINT scheduled_exports_format_chk
        CHECK (format IN ('csv', 'json')),
    CONSTRAINT scheduled_exports_last_status_chk
        CHECK (last_status IS NULL OR last_status IN ('ok', 'failed'))
);

-- Worker tick uses (next_run_at <= now() AND enabled) for its
-- DueBefore query. Partial index on enabled keeps it small even when
-- a power user has hundreds of disabled / archived schedules.
CREATE INDEX IF NOT EXISTS idx_scheduled_exports_next_run
    ON scheduled_exports (next_run_at)
    WHERE enabled;

-- Listing path is "give me my schedules ordered by name"; the per-
-- owner index avoids a full scan when many subjects coexist.
CREATE INDEX IF NOT EXISTS idx_scheduled_exports_owner
    ON scheduled_exports (owner_subject);
