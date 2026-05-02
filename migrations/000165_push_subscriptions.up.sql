-- Phase 40 / Prompt 52: Web Push (VAPID) subscriptions.
--
-- One row per browser-device-pairing returned by PushManager.subscribe().
-- The notification worker iterates over these to deliver out-of-tab OS-level
-- push notifications via the VAPID-protected Push API endpoint that each
-- subscription points at.
--
-- Schema notes:
--   - user_id is reserved for future multi-tenancy. NULL today (single-user
--     install). Mirrors saved_views / pinned_items / chart_annotations
--     (no users table exists yet, so a real FK would block the migration).
--     When multi-tenancy lands, the existing UNIQUE (user_id, endpoint)
--     constraint already keeps the same browser registering once per user.
--   - endpoint is the URL returned by PushManager.subscribe(); it identifies
--     the push service + channel for a single browser-device-pairing.
--     The Push API spec does not bound endpoint length, but in practice every
--     production endpoint we have observed fits in 2 KB; TEXT is unlimited
--     in Postgres so no value cap is needed.
--   - p256dh and auth are the two base64url keys returned by
--     subscription.getKey(); webpush-go needs both to encrypt the payload.
--   - last_used_at is touched on every successful push so the UI can show
--     "last used N ago" per device, and so the cleanup pass can prune
--     subscriptions that have been silent for a long time.
BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id      bigint,
    endpoint     text        NOT NULL,
    p256dh       text        NOT NULL,
    auth         text        NOT NULL,
    user_agent   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);

-- One row per (user, endpoint). COALESCE keeps the install-wide bucket
-- (NULL user_id) deduplicated; without it, NULLs would be considered
-- distinct and the same browser could register twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_user_endpoint
    ON push_subscriptions (COALESCE(user_id, 0), endpoint);

-- Hot path during fan-out: list every subscription for a user.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions (COALESCE(user_id, 0));

COMMENT ON TABLE  push_subscriptions IS
    'Web Push (VAPID) subscriptions — one row per browser-device-pairing (Phase 40 / Prompt 52).';
COMMENT ON COLUMN push_subscriptions.user_id IS
    'Reserved for future multi-tenancy. NULL today (single-user install).';
COMMENT ON COLUMN push_subscriptions.endpoint IS
    'Push service URL returned by PushManager.subscribe(); identifies a browser-device-pairing.';
COMMENT ON COLUMN push_subscriptions.p256dh IS
    'base64url ECDH public key from subscription.getKey("p256dh"); used for payload encryption.';
COMMENT ON COLUMN push_subscriptions.auth IS
    'base64url auth secret from subscription.getKey("auth"); used for payload encryption.';
COMMENT ON COLUMN push_subscriptions.last_used_at IS
    'Touched on every successful push delivery; surfaced as "last used N ago" in the per-device list.';

COMMIT;
