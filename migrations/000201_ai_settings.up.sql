-- Phase-50 / 0001 — F0 AI-Off Contract.
--
-- Per ADR-015 (AI-Off Contract), AI in TeslaSync is strictly additive
-- and default-off. The shipping default for the new ai_mode setting is
-- 'off'. A fresh install or an upgrade from any pre-Phase-50 release
-- performs no AI calls, requires no provider configuration, and exposes
-- no AI UI surfaces until the user explicitly enables AI in Settings.
--
-- Schema adaptation vs. the Phase-50 / 0001 prompt:
-- The prompt was written assuming a wide-column `settings` row, but
-- ADR-011 made `settings` a typed key/value store
-- (key, value_text, value_num, value_bool, data_kind). To honour
-- ADR-011 and still satisfy the prompt's intent (default-off, JSONB
-- feature map, JSONB provider config, integer cost cap), this
-- migration:
--   1. Adds a `value_jsonb` column for native JSONB storage.
--   2. Extends the `data_kind` CHECK to allow 'jsonb'.
--   3. Inserts the four canonical AI keys with their defaults.
--
-- Default-off invariant (ADR-015 §I1):
--   ai_mode = 'off'                      -- text
--   ai_features = '{}'::jsonb            -- empty per-feature opt-in map
--   ai_provider_config = '{}'::jsonb     -- no providers configured
--   ai_cost_cap_cents = 0                -- 0 = unset, rate limiter still applies
--
-- This file is reversible by the matching .down.sql.

BEGIN;

-- 1. Add the JSONB value column. Nullable so existing scalar rows are
--    untouched; `data_kind` continues to select which value_* column
--    is meaningful.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS value_jsonb jsonb;

-- 2. Extend the data_kind CHECK to allow 'jsonb'. The 000142 baseline
--    constraint name is `settings_data_kind_check` (Postgres default
--    when emitted as a column-level CHECK without an explicit name).
--    Drop-and-recreate is the supported path.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_data_kind_check;
ALTER TABLE settings
  ADD CONSTRAINT settings_data_kind_check
  CHECK (data_kind IN ('text', 'number', 'boolean', 'jsonb'));

COMMENT ON COLUMN settings.value_jsonb IS
  'Phase-50 / ADR-015: JSONB value when data_kind = ''jsonb''. Used by AI feature/provider config keys.';

-- 3. Seed the four AI keys with their default-off values. Use
--    ON CONFLICT DO NOTHING so re-running the migration on a database
--    where an admin has already toggled AI on does not silently force
--    them back to off.

INSERT INTO settings (key, value_text, data_kind, description)
  VALUES (
    'ai_mode',
    'off',
    'text',
    'ADR-015: AI feature gate. ''off'' (default) blocks all AI surfaces. ''local'' accepts only RFC1918/loopback providers. ''cloud'' allows any provider.'
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value_jsonb, data_kind, description)
  VALUES (
    'ai_features',
    '{}'::jsonb,
    'jsonb',
    'ADR-015: Per-feature opt-in map keyed by feature ID (see internal/ai/features/registry.go). Default {} = every feature off.'
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value_jsonb, data_kind, description)
  VALUES (
    'ai_provider_config',
    '{}'::jsonb,
    'jsonb',
    'ADR-015 §I9: Adapter-specific config (base_url, model, api_key_ref). NEVER returned to client when ai_mode=''off''.'
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value_num, data_kind, description)
  VALUES (
    'ai_cost_cap_cents',
    0,
    'number',
    'ADR-015 / F9: Daily AI cost cap in cents. 0 = unset (rate limiter still applies).'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
