-- Phase 40 / Prompt 56: per-session metadata for the chatbot UI.
--
-- chatbot_messages already exists (migration 000005) and stores one row per
-- user/assistant turn keyed on session_id (text). The Sessions endpoint
-- returns the distinct set of session_ids so the sidebar can list them, but
-- there is no place to hang per-session UI metadata — most importantly a
-- human-readable title that the user can rename inline. Without this table
-- the sidebar can only show the raw "s_1718712345123456789" generated id,
-- which is useless for distinguishing sessions.
--
-- Schema notes:
--   - session_id is the PRIMARY KEY (matches chatbot_messages.session_id which
--     is `text`). We do NOT add a foreign key to chatbot_messages because
--     that table has no UNIQUE constraint on session_id (it stores many rows
--     per session). Orphan rows are cleaned up by the DELETE handler.
--   - title is NULLable; when NULL the UI derives a fallback title from the
--     first user message in the session. Setting an explicit title via the
--     PATCH endpoint persists it across refreshes / devices.
--   - title length is capped at 120 chars to match the UI inline-rename input
--     and to keep the sidebar tidy.
--   - created_at/updated_at follow the rest of the schema for sortability and
--     "last edited N ago" affordances.
BEGIN;

CREATE TABLE IF NOT EXISTS chatbot_sessions (
    session_id text PRIMARY KEY,
    title      text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_updated_at
    ON chatbot_sessions (updated_at DESC);

COMMENT ON TABLE  chatbot_sessions IS
    'Per-session metadata (rename, ordering) for the AI assistant UI (Phase 40 / Prompt 56).';
COMMENT ON COLUMN chatbot_sessions.session_id IS
    'Matches chatbot_messages.session_id. No FK because chatbot_messages has no unique constraint on session_id.';
COMMENT ON COLUMN chatbot_sessions.title IS
    'Optional human-readable title. NULL means the UI falls back to the first user message of the session.';

COMMIT;
