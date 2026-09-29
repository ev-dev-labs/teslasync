BEGIN;

-- App sign-in binding for API keys (docs/apps.md).
-- A key with subject NULL keeps the historical behaviour: device-scoped,
-- X-API-Key, honoured only on /watch/*. A key with subject set was minted
-- as an app token and additionally authenticates as that subject on the
-- whole API via `Authorization: Bearer`, so a phone/desktop app can sign
-- in to any self-hosted server.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS subject VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_api_keys_subject ON api_keys (subject);

COMMIT;
