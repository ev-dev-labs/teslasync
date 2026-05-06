-- Phase-46 / Prompt 44 — RBAC role-permission bindings.
--
-- Provider-agnostic. Roles are identified by an opaque string (the
-- group name forwarded by the upstream auth provider via the
-- TESLASYNC_RBAC_GROUPS_HEADER header — typically X-Forwarded-Groups
-- for Authentik/Authelia or X-Auth-Groups for oauth2-proxy). Permission
-- ids come from a hand-maintained catalog in
-- internal/auth/permissions.go.
--
-- Bindings are sparse: missing rows mean "no opinion → fall back to
-- the implicit default". The repo's GetMatrix call left-joins the
-- catalog so the SPA always sees every (role, permission) cell, with
-- `allowed = false` for anything not explicitly granted.
--
-- The table intentionally does NOT FK either column:
--   - role_id is opaque proxy data (no roles registry exists)
--   - permission_id is application code (a deleted permission would
--     orphan rows; we sweep them on the next write rather than 500ing
--     the migration)
--
-- ON DELETE behaviour is therefore "soft"; the repo's UpsertCells
-- path filters out unknown permission_ids before write so a stale
-- entry from an older deploy can't leak into the response.

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       TEXT        NOT NULL,
    permission_id TEXT        NOT NULL,
    -- Allowed is the explicit grant flag. NULL is impossible because
    -- the only reason to keep a row is to say "yes" or "explicitly
    -- no" — a soft delete uses DELETE FROM, not allowed=NULL.
    allowed       BOOLEAN     NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

-- Per-role lookup is the only access pattern (the matrix endpoint
-- fans out across roles in one query, then groups by role_id in
-- application code). The PRIMARY KEY already covers (role_id,
-- permission_id), so no additional index is needed.
