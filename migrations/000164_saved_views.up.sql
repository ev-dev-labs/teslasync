-- Phase 40 / Prompt 50: durable storage for per-user "saved views" — a
-- named snapshot of the URL querystring on a list page (filters, sort,
-- pagination, date range, etc.) that the user wants to recall later.
--
-- Schema notes:
--   - user_id is reserved for future multi-tenancy. NULL today (single-user
--     install). Mirrors pinned_items / chart_annotations / dashboard_layouts
--     (no users table exists yet, so an FK would block the migration). When
--     multi-tenancy lands, the (user_id, route) uniqueness predicate flips
--     from "every install shares one bucket" to "per-user bucket" without
--     a schema change.
--   - route is the SPA pathname the view applies to (e.g. /drives). Routes
--     live in web/src/lib/routeRegistry.ts; the handler validates the value
--     before insert so a frontend typo can't insert a row no surface knows
--     how to render.
--   - query is the canonical querystring (no leading '?'). Capped at 4096
--     chars to keep the column comfortably indexable and discourage abuse.
--   - is_default selects the auto-applied view when the page mounts with
--     an empty querystring. Enforced at most one per (user, route) by the
--     partial unique index below.
--   - is_pinned floats a row to the top of the dropdown.
--   - sort_order is the per-(user, route) display order; lower wins.
BEGIN;

CREATE TABLE IF NOT EXISTS saved_views (
    id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id     bigint,
    name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    route       text        NOT NULL CHECK (route LIKE '/%' AND length(route) BETWEEN 1 AND 100),
    query       text        NOT NULL CHECK (length(query) <= 4096),
    is_default  boolean     NOT NULL DEFAULT FALSE,
    is_pinned   boolean     NOT NULL DEFAULT FALSE,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-user uniqueness within (route, name). COALESCE keeps two views with
-- the same name across users with NULL user_id from sneaking through (NULLs
-- are normally distinct in SQL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_user_route_name
    ON saved_views (COALESCE(user_id, 0), route, name);

-- Primary access pattern: list views for a user + route, ordered by
-- (pinned desc, sort_order asc, id asc).
CREATE INDEX IF NOT EXISTS idx_saved_views_user_route
    ON saved_views (COALESCE(user_id, 0), route, sort_order, id);

-- Only one default per (user, route). NULL user_id collapses to a single
-- default for the install, matching the single-user assumption above.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_default
    ON saved_views (COALESCE(user_id, 0), route)
    WHERE is_default = TRUE;

COMMENT ON TABLE  saved_views IS
    'Per-user named URL querystrings for list pages (Phase 40 / Prompt 50).';
COMMENT ON COLUMN saved_views.user_id IS
    'Reserved for future multi-tenancy. NULL today (single-user install).';
COMMENT ON COLUMN saved_views.route IS
    'SPA pathname the view applies to (e.g. /drives). Validated against the route registry by the handler.';
COMMENT ON COLUMN saved_views.query IS
    'Canonical querystring, no leading ? — applied verbatim to the URL when the view is selected.';
COMMENT ON COLUMN saved_views.is_default IS
    'When TRUE the view auto-applies on mount when the URL has no querystring. At most one per (user, route).';
COMMENT ON COLUMN saved_views.sort_order IS
    'Display order within (user, route). Lower values render first; pinned rows take precedence.';

COMMIT;
