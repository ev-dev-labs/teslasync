-- Phase-50 / 0008 — F7 Embeddings + pgvector RAG.
--
-- Two parallel embeddings tables, one per supported model dimension:
--   embeddings_768   — VECTOR(768)  for nomic-embed-text (PD3 local)
--   embeddings_1536  — VECTOR(1536) for text-embedding-3-small (PD3 cloud)
--
-- Two physical tables (rather than one column with mixed dimensions)
-- because pgvector requires a fixed dim per column, and HNSW indexes
-- cannot mix dims. The internal/ai/rag.PgvectorRetriever picks the
-- right table from the configured model name (see DimFor in
-- internal/ai/rag/rag.go).
--
-- Naming variance vs the prompt
-- -----------------------------
-- The prompt names the 768-dim table simply `embeddings`. Migration
-- 000142 (baseline_typed) already created an unrelated table with
-- that name (vector(384), entity_type/entity_id, never wired to any
-- production code path). Rather than DROP-and-recreate the legacy
-- table — a destructive operation that would risk an operator's
-- experimental data — we name our new table `embeddings_768` so the
-- new schema lives alongside the legacy one. The symmetric naming
-- (embeddings_768 + embeddings_1536) is also clearer at a glance.
--
-- ADR-015 invariants touched
-- --------------------------
--   §I1  Default-off          — tables are empty until a user opts
--                               into AI AND a feature toggle, AND a
--                               consumer slice (e.g. N6 RAG help)
--                               calls Index. The factory in
--                               internal/ai/rag/factory.go returns a
--                               NoopRetriever when ai_mode='off' so
--                               the SQL paths below are unreachable.
--   §I4  Zero outbound egress — no embedding call happens for off
--                               users; therefore no row lands here.
--                               The off-mode invariant suite asserts
--                               COUNT(*) = 0 across both tables.
--   §I8  Survives downgrade   — rows produced by past AI activity
--                               persist after a mode flip to off; the
--                               TTL cron is the only deletion path.
--
-- Schema adaptation vs the prompt
-- -------------------------------
-- The prompt specifies `user_id BIGINT NOT NULL REFERENCES users(id)
-- ON DELETE CASCADE`. TeslaSync has no `users` table — the platform
-- is single-tenant per ADR-015 and identifies principals via the
-- FORWARD_AUTH_HEADER subject string (see internal/auth/subject.go).
-- We therefore use `user_subject TEXT NOT NULL DEFAULT ''` matching
-- the existing F3 pattern (ai_call_log.user_subject). No FK, so
-- embeddings survive subject removal — required by §I8.
-- Open mode has no subject; it stores '' which the retriever treats
-- as the "global / open mode" partition. Single-tenant deployments
-- exclusively use '' so docs (which use '' as their subject) are
-- visible to every retrieval call.
--
-- Slot variance
-- -------------
-- Prompt says 000201 for this file; that slot is taken by F0's
-- ai_settings. Next free pair after F5 is 000205/000206; F7 takes
-- the second slot here.
--
-- HNSW build parameters
-- ---------------------
-- m=16, ef_construction=64 are the prompt's pinned values. They give
-- a build-time vs recall trade-off appropriate for ≤ 100k chunks per
-- table (the realistic upper bound for a self-hosted owner's app).
-- A larger corpus would benefit from m=32; this is a one-line index
-- rebuild and not a schema concern.
--
-- TTL / "never expire" sentinel
-- -----------------------------
-- expires_at uses the year 9999 sentinel returned by
-- internal/ai/rag/ttl.go ExpiresAt for sources that never expire
-- (currently only "docs"). The TTL cron's `WHERE expires_at < now()`
-- clause leaves these rows untouched. Storing a real timestamp
-- (rather than 'infinity'::timestamptz) keeps the column scannable
-- by ordinary planners and avoids a pgx round-trip mode switch.
--
-- Reversible by the matching .down.sql.

BEGIN;

-- ============================================================
-- 768-dimension table (nomic-embed-text and other compact models)
-- ============================================================

CREATE TABLE IF NOT EXISTS embeddings_768 (
    id            BIGSERIAL    PRIMARY KEY,
    user_subject  TEXT         NOT NULL DEFAULT '',
    source_type   TEXT         NOT NULL,
    source_id     TEXT         NOT NULL,
    chunk_idx     INTEGER      NOT NULL DEFAULT 0,
    text          TEXT         NOT NULL,
    text_hash     TEXT         NOT NULL,
    embedding     VECTOR(768)  NOT NULL,
    model         TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ  NOT NULL,

    -- Defence-in-depth invariants. The retriever code never inserts
    -- negative chunk indices or empty text/hash, but pinning the
    -- contract in SQL means a future direct INSERT (or a bug in a
    -- different package) cannot corrupt the table silently.
    CONSTRAINT embeddings_768_chunk_idx_chk    CHECK (chunk_idx >= 0),
    CONSTRAINT embeddings_768_text_nonempty    CHECK (length(text) > 0),
    CONSTRAINT embeddings_768_hash_nonempty    CHECK (length(text_hash) > 0),
    CONSTRAINT embeddings_768_model_nonempty   CHECK (length(model) > 0),
    CONSTRAINT embeddings_768_source_type_chk  CHECK (length(source_type) > 0),
    CONSTRAINT embeddings_768_source_id_chk    CHECK (length(source_id)   > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS embeddings_768_dedupe_idx
    ON embeddings_768 (user_subject, source_type, source_id, chunk_idx, model);

CREATE INDEX IF NOT EXISTS embeddings_768_user_source_idx
    ON embeddings_768 (user_subject, source_type);

CREATE INDEX IF NOT EXISTS embeddings_768_expires_idx
    ON embeddings_768 (expires_at);

-- HNSW (hierarchical navigable small world) cosine index. The
-- vector_cosine_ops opclass matches the `<=>` distance operator the
-- retriever uses in its ORDER BY clause. Build params per prompt
-- (m=16, ef_construction=64).
CREATE INDEX IF NOT EXISTS embeddings_768_hnsw_idx
    ON embeddings_768 USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================
-- 1536-dimension table (OpenAI text-embedding-3-small + peers)
-- ============================================================

CREATE TABLE IF NOT EXISTS embeddings_1536 (
    id            BIGSERIAL    PRIMARY KEY,
    user_subject  TEXT         NOT NULL DEFAULT '',
    source_type   TEXT         NOT NULL,
    source_id     TEXT         NOT NULL,
    chunk_idx     INTEGER      NOT NULL DEFAULT 0,
    text          TEXT         NOT NULL,
    text_hash     TEXT         NOT NULL,
    embedding     VECTOR(1536) NOT NULL,
    model         TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ  NOT NULL,

    CONSTRAINT embeddings_1536_chunk_idx_chk    CHECK (chunk_idx >= 0),
    CONSTRAINT embeddings_1536_text_nonempty    CHECK (length(text) > 0),
    CONSTRAINT embeddings_1536_hash_nonempty    CHECK (length(text_hash) > 0),
    CONSTRAINT embeddings_1536_model_nonempty   CHECK (length(model) > 0),
    CONSTRAINT embeddings_1536_source_type_chk  CHECK (length(source_type) > 0),
    CONSTRAINT embeddings_1536_source_id_chk    CHECK (length(source_id)   > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS embeddings_1536_dedupe_idx
    ON embeddings_1536 (user_subject, source_type, source_id, chunk_idx, model);

CREATE INDEX IF NOT EXISTS embeddings_1536_user_source_idx
    ON embeddings_1536 (user_subject, source_type);

CREATE INDEX IF NOT EXISTS embeddings_1536_expires_idx
    ON embeddings_1536 (expires_at);

CREATE INDEX IF NOT EXISTS embeddings_1536_hnsw_idx
    ON embeddings_1536 USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================
-- Documentation comments
-- ============================================================

COMMENT ON TABLE embeddings_768 IS
    'Phase-50 F7: 768-dim embeddings for local-mode models (PD3: nomic-embed-text). '
    'ADR-015 §I1: empty when ai_mode=off (factory returns NoopRetriever). '
    '§I8: rows survive a mode downgrade — only the TTL cron deletes.';

COMMENT ON TABLE embeddings_1536 IS
    'Phase-50 F7: 1536-dim embeddings for cloud-mode models (PD3: text-embedding-3-small). '
    'Same off-mode and durability contracts as `embeddings_768`.';

COMMENT ON COLUMN embeddings_768.user_subject IS
    'FORWARD_AUTH_HEADER subject string (internal/auth/subject.go). '
    'Empty string '''' in single-tenant / open-mode installations. '
    'Mirrors ai_call_log.user_subject; no FK so history survives subject removal (ADR-015 §I8).';
COMMENT ON COLUMN embeddings_768.source_type IS
    'Domain bucket: docs | drive_summary | charge_session | alert_history | automation_run | user_note. '
    'TTL policy (internal/ai/rag/ttl.go) is keyed by this column.';
COMMENT ON COLUMN embeddings_768.source_id IS
    'Domain key (drive_id, charge_session_id, doc filepath, etc). Stable across re-embeds.';
COMMENT ON COLUMN embeddings_768.chunk_idx IS
    '0-based index of the chunk within (source_type, source_id). The retriever DELETEs '
    'rows with chunk_idx >= len(chunks) on every Index call so a shrunk source cannot leak stale chunks.';
COMMENT ON COLUMN embeddings_768.text IS
    'Post-redaction chunk text. F8 (slice 0009) plugs in here; F7 stores raw text for sources '
    'with no PII (currently only `docs`).';
COMMENT ON COLUMN embeddings_768.text_hash IS
    'sha256 of the text column. The retriever pre-queries this to skip embed cost on unchanged chunks.';
COMMENT ON COLUMN embeddings_768.embedding IS
    '768-dim vector from a nomic-embed-text-class model. Indexed via HNSW (m=16, ef_construction=64).';
COMMENT ON COLUMN embeddings_768.model IS
    'Vendor model id at embed time. Stored alongside the dim so a future model rotation can '
    'distinguish stale rows without re-deriving from text content.';
COMMENT ON COLUMN embeddings_768.expires_at IS
    'TTL deadline. The year-9999 sentinel from internal/ai/rag/ttl.go marks sources that never expire. '
    'The internal/jobs/embeddings_ttl cron deletes rows with expires_at < now().';

COMMENT ON COLUMN embeddings_1536.user_subject IS
    'See embeddings_768.user_subject. Same contract; different vector dimension.';

COMMIT;
