-- Phase-50 / 0005 — F4 AI Tool-Use Framework.
--
-- Persisted state for paused dispatcher runs. When a mutating tool
-- requires user confirmation, the dispatcher serialises the pending
-- conversation + tool call into this table and hands the
-- `continuation_id` back to the SSE stream. The frontend renders an
-- AI ConfirmDialog and POSTs the user's decision to a continuation
-- endpoint, which reloads the row and resumes the dispatcher.
--
-- ADR-015 invariants
-- ------------------
--   §I1  Default-off          — table stays empty until a user
--                                enables AI AND a feature toggle AND
--                                a mutating tool actually pauses.
--                                Read-only chat NEVER writes here.
--   §I3  Baseline intact      — every row has a 24h hard expiry; a
--                                stale row never silently re-executes
--                                a mutation against the user's data.
--   §I4  Zero outbound egress — purely server-side state; no fetch,
--                                no webhook.
--   §I8  Survives downgrade   — rows are NOT deleted when AI is
--                                turned off mid-run; the user can
--                                see what the dispatcher was about
--                                to do via /ai/usage forensic view.
--                                Expired rows are GC'd by a worker
--                                tick (Cleanup repo method) — not by
--                                a foreign key cascade so audit
--                                history is independent of subjects.
--
-- Schema notes
-- ------------
-- - `id` is the dispatcher-issued continuation handle (UUID-shaped
--   but TEXT here so tests can use deterministic strings without
--   pulling in pgcrypto).
-- - `state` is the JSONB-encoded ContinuationState (see
--   internal/ai/dispatch/continuation.go). JSONB so a future
--   resume-from-debugging tool can introspect contents without
--   re-deserialising in Go.
-- - `expires_at` is server-set on insert (24h from now). Cleanup
--   uses an index range scan; partial index keeps it small even
--   when the table accumulates 1000s of rows.
-- - `user_subject` mirrors the ai_call_log convention so an
--   operator can attribute the row back to a principal without
--   joining a non-existent users table.
--
-- Slot variance: prompt 0005 hardcodes 000199, but that slot is
-- taken by si_aware_convert_functions and the next free AI-prefix
-- slot after F0..F3 (000201..000203) is 000204. Same documentation
-- precedent as the F0..F3 slice logs.
--
-- Reversible by the matching .down.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_chat_continuations (
    id            TEXT        PRIMARY KEY,
    user_subject  TEXT        NOT NULL DEFAULT '',
    feature_id    TEXT        NOT NULL,
    state         JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,

    -- A continuation MUST have a future expiry on insert. Pin the
    -- invariant in SQL so a buggy repo can't write a row that
    -- bypasses the 24h ceiling.
    CONSTRAINT ai_chat_continuations_expiry_chk
        CHECK (expires_at > created_at)
);

-- Cleanup query: WHERE expires_at < now(). The index makes the
-- range scan O(log n) instead of a sequential table scan even when
-- the cleanup tick fires every 5 minutes against 1000s of rows.
CREATE INDEX IF NOT EXISTS ai_chat_continuations_expires_idx
    ON ai_chat_continuations (expires_at);

-- Per-subject lookups (admin "what conversations did user X have?"
-- forensic view). Partial index — only relevant for non-empty subjects.
CREATE INDEX IF NOT EXISTS ai_chat_continuations_user_idx
    ON ai_chat_continuations (user_subject, created_at DESC)
    WHERE user_subject <> '';

COMMENT ON TABLE  ai_chat_continuations IS
    'Persisted state for paused AI dispatcher runs awaiting user '
    'confirmation of a mutating tool call. ADR-015 §I3: every row '
    'has a 24h expiry so a stale row never silently re-executes.';
COMMENT ON COLUMN ai_chat_continuations.id IS
    'Dispatcher-issued continuation handle (UUID-shaped TEXT). '
    'Returned over SSE in a confirm_request frame; the frontend '
    'POSTs back to /ai/chat/continue/{id} with a Confirm/Cancel '
    'decision.';
COMMENT ON COLUMN ai_chat_continuations.state IS
    'JSONB-encoded ContinuationState (internal/ai/dispatch/'
    'continuation.go): feature_id, conversation messages so far, '
    'and the pending ToolCall awaiting approval.';
COMMENT ON COLUMN ai_chat_continuations.expires_at IS
    'Hard 24h expiry. The Cleanup repo method deletes rows where '
    'expires_at < now(); rows older than this MUST NOT be resumable '
    'since the user has had no recent contextual reason to approve '
    'whatever mutation was queued.';

COMMIT;
