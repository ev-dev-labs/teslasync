-- Phase-46 / Prompt 57 — Auth-mode contract foundational schema.
--
-- TeslaSync is provider-agnostic: the upstream proxy (Authentik,
-- Authelia, oauth2-proxy, Keycloak, …) is the sole identity authority.
-- The configured FORWARD_AUTH_HEADER (typically X-Forwarded-User)
-- carries an opaque per-user "subject" string that TeslaSync never
-- normalises and never tries to resolve via a vendor-specific admin
-- API. This table is the local materialisation of every distinct
-- subject we have ever observed, recorded by the
-- internal/auth.SubjectRecorder middleware. Every downstream
-- per-user table SHOULD reference this column instead of inventing
-- its own foreign-key target — a non-existent users(id) column has
-- been a recurring source of bugs in earlier phase-46 prompts.
--
-- Open mode (no FORWARD_AUTH_HEADER configured) never writes a row
-- here; the recorder middleware is a no-op passthrough in that case.
--
-- display_name + notes are operator-editable surfaces for a future
-- admin "users" panel. They are intentionally nullable so the recorder
-- can insert a bare row without an admin ever editing it.

CREATE TABLE IF NOT EXISTS auth_subjects (
    subject       TEXT        PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    display_name  TEXT,
    notes         TEXT
);

-- Sorted-by-recency listing index. The future admin "users" panel
-- pages on this without scanning the full table. Cardinality is
-- bounded by the number of distinct human operators, so the index is
-- effectively constant size.
CREATE INDEX IF NOT EXISTS idx_auth_subjects_last_seen
    ON auth_subjects (last_seen_at DESC);
