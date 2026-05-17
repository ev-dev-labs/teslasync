-- Phase-50 / 0004 — F3 AI Call Log + Usage Card.
--
-- Per-call audit trail for every AI provider invocation. The Audit
-- decorator (internal/ai/provider/audit.go) writes one row per Chat /
-- Stream / Embed call, including token counts, latency, computed cost,
-- and a sha256 digest of the redacted prompt so a bug report can be
-- reproduced without storing PII.
--
-- ADR-015 invariants
-- ------------------
--   §I1  Default-off          — table is empty until a user enables AI
--                                AND a feature toggle, AND a call lands.
--   §I4  Zero outbound egress  — when ai_mode='off' the audit decorator
--                                is unreachable (no provider built); the
--                                table count must stay 0. The /ai/usage
--                                handler returns 404 in off mode.
--   §I7  Per-feature opt-in    — every row carries the feature_id that
--                                triggered it. The usage card breaks
--                                spend down by feature so the user can
--                                pinpoint which toggle is costing money.
--   §I8  Survives downgrade    — rows are not deleted when AI is turned
--                                off; the user keeps a verifiable trail
--                                of past activity.
--
-- Schema adaptation vs the prompt
-- -------------------------------
-- The prompt specified `user_id BIGINT REFERENCES users(id) ON DELETE
-- CASCADE`. TeslaSync has no `users` table — the platform is single-
-- tenant per ADR-015 and identifies principals via the
-- FORWARD_AUTH_HEADER subject string (see internal/auth/subject.go).
-- We therefore use `user_subject TEXT NOT NULL DEFAULT ''` matching the
-- existing Phase-46 pattern (scheduled_exports.owner_subject, etc).
-- No FK so audit history survives subject removal — required by §I8.
-- Open mode has no subject; it stores '' (empty string) which the
-- usage queries treat as "system / open mode" rows.
--
-- Slot variance: prompt 0004 hardcodes 000198, but slot 000198 is taken
-- by status_incidents and the next free AI-prefix slot after F0 (000201)
-- and F2 (000202) is 000203. The mqtt + tesla pipeline phases set the
-- precedent for slot-variance documentation.
--
-- Retention + compression
-- -----------------------
-- PD4 from the methodology: 180 day retention, compress chunks ≥7 days
-- old. Compression segmentby `user_subject` keeps per-user usage queries
-- fast even on compressed chunks (TimescaleDB pushes segmentby filters
-- below the decompression layer).
--
-- Reversible by the matching .down.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_call_log (
    id                BIGSERIAL    NOT NULL,
    user_subject      TEXT         NOT NULL DEFAULT '',
    feature_id        TEXT         NOT NULL,
    provider          TEXT         NOT NULL,
    model             TEXT         NOT NULL,
    input_tokens      INTEGER      NOT NULL DEFAULT 0,
    output_tokens     INTEGER      NOT NULL DEFAULT 0,
    cost_micro_cents  BIGINT       NOT NULL DEFAULT 0,
    latency_ms        INTEGER      NOT NULL DEFAULT 0,
    finish_reason     TEXT         NOT NULL DEFAULT '',
    request_hash      TEXT         NOT NULL DEFAULT '',
    redacted_digest   TEXT         NOT NULL DEFAULT '',
    error             TEXT         NULL,
    started_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Hypertable PK MUST include the time dimension so TimescaleDB
    -- can chunk by started_at without losing uniqueness on id.
    PRIMARY KEY (id, started_at),

    -- Defence in depth at the DB layer: we only ever record one of
    -- the canonical providers + the eval mock. A typo in the audit
    -- decorator surfaces as a write-time error rather than silently
    -- corrupting the usage card breakdown.
    CONSTRAINT ai_call_log_provider_chk
        CHECK (provider IN ('ollama','openai','anthropic','mock')),

    -- Token + cost columns are non-negative by construction in the
    -- decorator; pin the invariant in SQL so a future direct INSERT
    -- can't bypass it.
    CONSTRAINT ai_call_log_tokens_chk
        CHECK (input_tokens >= 0 AND output_tokens >= 0),
    CONSTRAINT ai_call_log_cost_chk
        CHECK (cost_micro_cents >= 0),
    CONSTRAINT ai_call_log_latency_chk
        CHECK (latency_ms >= 0),

    -- finished_at MUST be ≥ started_at; otherwise the latency_ms
    -- math (and the usage card "duration" axis) breaks subtly.
    CONSTRAINT ai_call_log_time_order_chk
        CHECK (finished_at >= started_at)
);

-- Hypertable conversion. 7-day chunks match the compression policy
-- below (compress immediately after a chunk closes).
SELECT create_hypertable('ai_call_log', 'started_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

-- The usage card's "Today" + "Recent" queries are
-- (user_subject, started_at DESC); the per-feature breakdown is
-- (feature_id, started_at DESC). Both indexes are partial-free so
-- TimescaleDB can push the time predicate into chunk pruning.
CREATE INDEX IF NOT EXISTS ai_call_log_user_started_idx
    ON ai_call_log (user_subject, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_feature_started_idx
    ON ai_call_log (feature_id, started_at DESC);

-- Compression policy: segmentby user_subject so per-user range scans
-- on compressed chunks stay efficient. Order by started_at DESC so
-- the "most recent first" reads decompress only the leading rows.
ALTER TABLE ai_call_log SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'user_subject',
    timescaledb.compress_orderby   = 'started_at DESC'
);

-- Compress chunks ≥ 7 days old; retain 180 days total (PD4).
SELECT add_compression_policy('ai_call_log', INTERVAL '7 days',
    if_not_exists => TRUE);
SELECT add_retention_policy ('ai_call_log', INTERVAL '180 days',
    if_not_exists => TRUE);

COMMENT ON TABLE  ai_call_log IS
    'Per-call audit log for AI provider invocations. ADR-015 §I4: empty '
    'when ai_mode=off (decorator unreachable). §I8: rows survive a mode '
    'downgrade so the user always has a verifiable trail.';
COMMENT ON COLUMN ai_call_log.user_subject IS
    'FORWARD_AUTH_HEADER subject string (internal/auth/subject.go). '
    'Empty string in open mode or for system-attributed background '
    'jobs. No FK so audit history survives subject removal (ADR-015 §I8).';
COMMENT ON COLUMN ai_call_log.feature_id IS
    'Registry feature ID (internal/ai/features/registry.go). The usage '
    'card breaks spend down by this column; the value MUST match a '
    'features.IsKnown(id) entry — the decorator validates at insert time.';
COMMENT ON COLUMN ai_call_log.cost_micro_cents IS
    'Computed cost in micro-cents (1 cent = 10000 micro-cents). Local '
    'providers (Ollama, mock) record 0; cloud providers use the table '
    'in internal/ai/cost. Stored as BIGINT to avoid floating-point '
    'rounding when the usage card sums per-day spend.';
COMMENT ON COLUMN ai_call_log.request_hash IS
    'sha256 of (model || canonical-JSON(messages)). Lets ops correlate '
    'duplicate calls (e.g. retries after a stream stall) without '
    'storing the prompt body.';
COMMENT ON COLUMN ai_call_log.redacted_digest IS
    'sha256 of the post-redaction prompt body. Combined with the F8 '
    'redaction policy version (logged separately) this is enough to '
    'reproduce a bug report without storing PII (ADR-015 §I9 spirit).';
COMMENT ON COLUMN ai_call_log.error IS
    'Provider error message when the call failed. NULL on success. '
    'Bounded by Postgres TEXT — the decorator truncates to 4 KiB.';

COMMIT;
