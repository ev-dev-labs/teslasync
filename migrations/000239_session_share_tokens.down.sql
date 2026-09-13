-- Roll back session share links. Session-bound rows cannot survive the
-- drive_id NOT NULL restore, so they are removed first (share links are
-- disposable by design; revoke semantics).
DELETE FROM share_tokens WHERE charging_session_id IS NOT NULL;

ALTER TABLE share_tokens
    DROP CONSTRAINT IF EXISTS share_tokens_exactly_one_target;

ALTER TABLE share_tokens
    ALTER COLUMN drive_id SET NOT NULL;

DROP INDEX IF EXISTS idx_share_tokens_charging_session;

ALTER TABLE share_tokens
    DROP COLUMN IF EXISTS charging_session_id;
