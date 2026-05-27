-- Phase-44 / observability-batch / Prompt F4+F8 — audit tables for
-- DLQ replay actions and feature-flag changes.
--
-- DLQ_REPLAY_AUDIT
-- ─────────────────
-- Every replay of a dead-lettered MQTT message through /api/v1/system/dlq/{id}/replay
-- records here BEFORE the broker publish. The rubber-duck critique (R1) flagged
-- that an unaudited replay button is a production footgun — replaying a poison
-- pill can re-trigger codec failures, flood the DLQ, or DoS ingest. This table
-- gives ops a durable "who/what/when" trail so a post-incident investigation can
-- distinguish a deliberate operational action from a wedge.
--
-- We deliberately store the raw payload here (jsonb): a replay record is only
-- useful if the same payload that was replayed is still recoverable when the
-- in-memory ring buffer has rotated.
--
-- FEATURE_FLAG_CHANGES
-- ─────────────────────
-- Every write through the feature flag admin endpoints
-- (PUT/DELETE /api/v1/system/flags/{key}) records here BEFORE the Redis write.
-- Generic request-audit middleware captures the HTTP envelope but not the
-- before/after value diff a post-mortem actually needs. Storing both old_value
-- and new_value (each as text — JSON-stringified by the handler) makes the
-- common "who toggled this an hour before the incident, and from what?"
-- question answerable from a single SELECT.

CREATE TABLE IF NOT EXISTS dlq_replay_audit (
    id          BIGSERIAL PRIMARY KEY,
    replayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor       TEXT        NOT NULL,             -- forward-auth subject or 'system' when no auth header present
    actor_ip    INET,                              -- best-effort: from X-Forwarded-For / RemoteAddr
    dlq_id      TEXT        NOT NULL,             -- in-memory ring id (32-char hex)
    src_topic   TEXT        NOT NULL,             -- the DLQ topic the message arrived on (NOT the original telemetry topic — that's inside payload.Topic)
    dst_topic   TEXT,                              -- the topic the replay targeted; NULL when result != 'ok' (no publish attempted)
    payload     JSONB,                             -- raw envelope JSON; NULL when the envelope failed to parse at ingest
    reason      TEXT,                              -- the original codec/router failure reason carried on the DLQ envelope
    result      TEXT        NOT NULL,             -- closed set, see CHECK below — keep in sync with internal/database/dlq_replay_audit_repo.go DLQReplayResult*
    error       TEXT,                              -- non-null when result != 'ok'
    trace_id    TEXT,                              -- propagated from the request span so the audit row links to the Jaeger trace
    CONSTRAINT dlq_replay_audit_result_check
        CHECK (result IN ('ok', 'publish_failed', 'rate_limited', 'disabled', 'not_found', 'unparseable'))
);

CREATE INDEX IF NOT EXISTS dlq_replay_audit_replayed_at_idx
    ON dlq_replay_audit (replayed_at DESC);

CREATE INDEX IF NOT EXISTS dlq_replay_audit_actor_idx
    ON dlq_replay_audit (actor, replayed_at DESC);


CREATE TABLE IF NOT EXISTS feature_flag_changes (
    id         BIGSERIAL PRIMARY KEY,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor      TEXT        NOT NULL,
    actor_ip   INET,
    flag_key   TEXT        NOT NULL,             -- e.g. 'ingest.si_canonical_cutover'
    operation  TEXT        NOT NULL,             -- 'set' | 'delete'
    old_value  TEXT,                              -- NULL on first 'set'; populated thereafter; JSON-stringified
    new_value  TEXT,                              -- NULL on 'delete'; JSON-stringified
    reason     TEXT,                              -- optional operator note from the X-Change-Reason header
    trace_id   TEXT,
    CONSTRAINT feature_flag_changes_operation_check CHECK (operation IN ('set', 'delete'))
);

CREATE INDEX IF NOT EXISTS feature_flag_changes_changed_at_idx
    ON feature_flag_changes (changed_at DESC);

CREATE INDEX IF NOT EXISTS feature_flag_changes_flag_key_idx
    ON feature_flag_changes (flag_key, changed_at DESC);
