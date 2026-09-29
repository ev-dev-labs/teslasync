BEGIN;

DROP INDEX IF EXISTS idx_api_keys_subject;
ALTER TABLE api_keys DROP COLUMN IF EXISTS subject;

COMMIT;
