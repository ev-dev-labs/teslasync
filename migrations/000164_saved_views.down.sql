-- Reverse migration 000164: drop saved_views table.
BEGIN;

DROP INDEX IF EXISTS uq_saved_views_default;
DROP INDEX IF EXISTS idx_saved_views_user_route;
DROP INDEX IF EXISTS uq_saved_views_user_route_name;
DROP TABLE IF EXISTS saved_views;

COMMIT;
