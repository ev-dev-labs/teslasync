-- 000208_ai_provider_config_renest.up.sql
--
-- Phase-50 / F1↔F2 schema reconciliation.
--
-- The F2 settings UI initially serialized `ai_provider_config` in a
-- flat shape:
--
--     {"provider":"ollama","base_url":"...","model":"...","api_key":"..."}
--
-- F1's `ParseProviderConfig` (`internal/ai/provider/config.go`)
-- expects the namespaced shape that the methodology and the
-- multi-provider design require:
--
--     {
--       "default": "ollama",
--       "ollama":  {"base_url":"...","model":"...","api_key":"..."},
--       "openai":  {"base_url":"...","model":"..."},
--       ...
--     }
--
-- When the flat shape was stored, `ParseProviderConfig` couldn't
-- find `raw["ollama"]` and fell through to `applyDefaults` which
-- substituted `DefaultLocalBaseURL = "http://localhost:11434"` —
-- unreachable from inside the API container — causing every AI
-- call to fail with "dial tcp [::1]:11434: connect: connection
-- refused" no matter what the user typed in the UI.
--
-- This migration converts any legacy flat row to the canonical
-- namespaced shape in-place. It is idempotent: rows already in
-- the namespaced shape (or rows missing `provider` entirely) are
-- skipped by the WHERE clause.
--
-- The down migration is intentionally a no-op — round-tripping
-- back to flat would silently delete any non-default providers'
-- entries, which is unsafe.

BEGIN;

UPDATE settings
SET value_jsonb = jsonb_build_object(
        'default', value_jsonb ->> 'provider',
        value_jsonb ->> 'provider',
        jsonb_strip_nulls(
            jsonb_build_object(
                'base_url', value_jsonb ->> 'base_url',
                'model',    value_jsonb ->> 'model',
                'api_key',  value_jsonb ->> 'api_key'
            )
        )
    ),
    updated_at = NOW()
WHERE key = 'ai_provider_config'
  -- Legacy flat shape: has a top-level `provider` string but no
  -- `default` key. The namespaced shape always carries `default`
  -- (or, for legacy rows from before any save, none of these keys
  -- at all — those need no conversion).
  AND value_jsonb ? 'provider'
  AND NOT (value_jsonb ? 'default')
  AND value_jsonb ->> 'provider' IS NOT NULL
  AND value_jsonb ->> 'provider' <> '';

COMMIT;
