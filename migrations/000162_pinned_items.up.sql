-- Phase 40 / Prompt 48: unified per-user "pin" storage.
--
-- Replaces the ad-hoc favorite mechanisms scattered across the frontend
-- (per-vehicle command favorites in localStorage, dashboard widget
-- "favorites", etc.) with a single durable table. Surfaces that need
-- "pinned-first" ordering query this table by item_type and merge the
-- result with their natural list before rendering.
--
-- Schema notes:
--   - user_id is reserved for future multi-tenancy. NULL today (single-user
--     install). Mirrors the chart_annotations / dashboard_layouts pattern
--     introduced earlier in phase-40 (no users table exists yet, so an FK
--     would block the migration).
--   - item_type is a closed enum enforced by CHECK so a typo on the
--     frontend can't insert a row that no surface knows how to render.
--   - item_id is TEXT to accommodate composite keys (e.g. "drive:123") and
--     non-numeric ids (e.g. command id "doors.unlock") without needing
--     per-type tables. Numeric ids are stored as decimal strings.
--   - position is the per-(user, type, context) display order; lower wins.
--     Inserts default to 0 so the newest pin floats to the top.
--   - context is an optional scoping string (e.g. dashboard_id when pinning
--     a widget so the same widget can be pinned on multiple dashboards
--     independently). NULL means "global within the user+type scope".
--   - The unique constraint coalesces context to '' so one user can't pin
--     the same item twice within the same scope.
BEGIN;

CREATE TABLE IF NOT EXISTS pinned_items (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id      bigint,
  item_type    text NOT NULL CHECK (item_type IN (
    'vehicle','widget','alert_rule','location','geofence','automation','dashboard','command'
  )),
  item_id      text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  position     integer NOT NULL DEFAULT 0,
  pinned_at    timestamptz NOT NULL DEFAULT now(),
  context      text CHECK (context IS NULL OR length(context) <= 200)
);

-- Per-user uniqueness within a (type, context) bucket. COALESCE keeps two
-- pins of the same item with NULL context from sneaking through the unique
-- constraint (NULLs are normally distinct in SQL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pinned_items_unique
  ON pinned_items (
    COALESCE(user_id, 0),
    item_type,
    item_id,
    COALESCE(context, '')
  );

-- Primary access pattern: list pins for a user + type, ordered by position.
CREATE INDEX IF NOT EXISTS idx_pinned_items_user_type_position
  ON pinned_items (COALESCE(user_id, 0), item_type, position, id);

COMMENT ON TABLE  pinned_items IS
  'Per-user pinned/favorite items across vehicles, widgets, alert rules, etc. Phase 40 / Prompt 48.';
COMMENT ON COLUMN pinned_items.user_id IS
  'Reserved for future multi-tenancy. NULL today (single-user install).';
COMMENT ON COLUMN pinned_items.item_id IS
  'Stable identifier of the pinned entity. TEXT so composite/non-numeric ids are supported.';
COMMENT ON COLUMN pinned_items.position IS
  'Display order within (user_id, item_type, context). Lower values render first.';
COMMENT ON COLUMN pinned_items.context IS
  'Optional scope (e.g. dashboard_id when pinning a widget on a specific dashboard).';

COMMIT;
