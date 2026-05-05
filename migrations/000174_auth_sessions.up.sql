-- Phase-46 / Prompt 42 — Active sessions / device management.
--
-- When TeslaSync runs behind a ForwardAuth provider (Authentik, Authelia,
-- oauth2-proxy, Keycloak, …) the user has no in-app way to see which
-- browsers / devices are currently signed in or to invalidate one without
-- visiting the upstream provider's admin console. This table records
-- TeslaSync's OWN cookie binding for every authenticated principal so the
-- Settings page can list devices and revoke individual sessions
-- locally — independent of the upstream IdP's session state.
--
-- Provider-agnostic: TeslaSync never speaks to the upstream IdP's admin
-- API. Revoking a row here only kills the TeslaSync cookie binding;
-- subsequent requests bearing that cookie are rejected by the
-- session-tracker middleware regardless of the upstream session.
--
-- Subject identity comes from the opaque value carried by the configured
-- FORWARD_AUTH_HEADER (typically X-Forwarded-User). This intentionally
-- does NOT FK to a `users(id)` table because TeslaSync has no users table
-- — the proxy is the sole identity authority. When prompt 57
-- (auth-mode-contract) lands, this column SHOULD be tightened with
-- `REFERENCES auth_subjects(subject) ON DELETE CASCADE`.

-- gen_random_uuid() is built into PostgreSQL 13+; the IF NOT EXISTS
-- guard makes the migration safe on older installs that pulled in
-- pgcrypto manually.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subject         TEXT        NOT NULL,
    -- HMAC-SHA256 of the TeslaSync-issued cookie value. We never store
    -- the raw cookie so a memory dump of the database alone cannot be
    -- replayed against the API. UNIQUE so the lookup index doubles as a
    -- collision guard for the (statistically impossible but still
    -- belt-and-braces) HMAC clash.
    cookie_hash     BYTEA       NOT NULL UNIQUE,
    user_agent      TEXT,
    ip              INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

-- Per-subject lookup, ordered by recency. The session-list endpoint
-- pages on this index without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_subject
    ON auth_sessions (subject, last_seen_at DESC);

-- Filter helper for the listing endpoint, which only ever returns
-- non-revoked rows. Revoked rows are kept around as a tombstone audit
-- trail — they're invisible to the SPA but available for forensics.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON auth_sessions (subject, last_seen_at DESC)
    WHERE revoked_at IS NULL;
