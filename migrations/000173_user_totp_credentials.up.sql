-- Phase-46 / Prompt 35 — TOTP enrollment.
--
-- TeslaSync owns its own TOTP layer regardless of what the upstream
-- ForwardAuth provider supports. The shared step-up TOTP secret
-- TESLASYNC_SUDO_TOTP_SECRET (prompt 31) is provider-agnostic but
-- single-secret; this migration introduces per-user enrollment so each
-- ForwardAuth subject can register their own authenticator.
--
-- Two tables instead of one status column so:
--   * pending enrollments have a server-enforced 15-minute TTL
--     (PruneExpiredEnrollments) without needing a partial index +
--     status filter on every read.
--   * the active credentials row never needs an "is this column NULL?"
--     gate — every column on user_totp_credentials is meaningful.
--
-- The `subject` PK is the opaque value carried by the configured
-- FORWARD_AUTH_HEADER (typically X-Forwarded-User). This intentionally
-- does NOT FK to a users(id) table because TeslaSync has no users
-- table — the proxy is the sole identity authority. When prompt 57
-- (auth-mode-contract) lands, both `subject` columns SHOULD be tightened
-- with `REFERENCES auth_subjects(subject) ON DELETE CASCADE`.

CREATE TABLE IF NOT EXISTS user_totp_enrollments (
    subject              TEXT        PRIMARY KEY,
    secret_encrypted     BYTEA       NOT NULL,
    backup_codes_hashed  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_user_totp_enrollments_expires_at
    ON user_totp_enrollments (expires_at);

CREATE TABLE IF NOT EXISTS user_totp_credentials (
    subject              TEXT        PRIMARY KEY,
    secret_encrypted     BYTEA       NOT NULL,
    backup_codes_hashed  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    activated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at         TIMESTAMPTZ,
    failed_attempts      INTEGER     NOT NULL DEFAULT 0,
    last_failed_at       TIMESTAMPTZ
);

-- Lookup index for admin-side credential listing (future RBAC page).
-- The PK already covers the per-subject lookup the verify path needs.
CREATE INDEX IF NOT EXISTS idx_user_totp_credentials_activated_at
    ON user_totp_credentials (activated_at DESC);
