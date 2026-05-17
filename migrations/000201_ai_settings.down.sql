-- Phase-50 / 0001 — F0 AI-Off Contract (rollback).
--
-- Removes the AI keys, drops the value_jsonb column, and restores the
-- pre-Phase-50 data_kind CHECK to its three-value form. Order matters:
-- the keys MUST be deleted before the constraint is rolled back so the
-- post-rollback CHECK does not fail validation against a stray
-- data_kind = 'jsonb' row.

BEGIN;

DELETE FROM settings WHERE key IN (
  'ai_mode',
  'ai_features',
  'ai_provider_config',
  'ai_cost_cap_cents'
);

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_data_kind_check;
ALTER TABLE settings
  ADD CONSTRAINT settings_data_kind_check
  CHECK (data_kind IN ('text', 'number', 'boolean'));

ALTER TABLE settings DROP COLUMN IF EXISTS value_jsonb;

COMMIT;
