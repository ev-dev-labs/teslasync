-- Reverse migration 000165: drop push_subscriptions table.
BEGIN;

DROP INDEX IF EXISTS idx_push_subscriptions_user;
DROP INDEX IF EXISTS uq_push_subscriptions_user_endpoint;
DROP TABLE IF EXISTS push_subscriptions;

COMMIT;
