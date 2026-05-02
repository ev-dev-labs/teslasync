-- Reverse migration 000162: drop pinned_items table.
BEGIN;

DROP INDEX IF EXISTS idx_pinned_items_user_type_position;
DROP INDEX IF EXISTS idx_pinned_items_unique;
DROP TABLE IF EXISTS pinned_items;

COMMIT;
