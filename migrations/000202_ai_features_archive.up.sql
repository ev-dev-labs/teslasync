-- Phase-50 / 0003 — F2 Settings UI for AI.
--
-- Adds the `ai_features_archived` JSONB row that the settings handler
-- writes when the user flips ai_mode to 'off'. Per ADR-015 §I7 the
-- per-feature opt-in map is cleared on a mode→off transition (so a
-- subsequent mode flip back to 'local'/'cloud' never silently
-- re-enables features), but the user's prior selection is preserved
-- in this archive so the F2 UI can offer an explicit
-- "Restore previous selection?" panel.
--
-- Storage shape (typed key/value, ADR-011):
--   key            = 'ai_features_archived'
--   data_kind      = 'jsonb'
--   value_jsonb    = '{}'::jsonb        (default — nothing archived yet)
--
-- Default-off invariant (ADR-015 §I1) is unaffected: the row defaults
-- to '{}' on a fresh install, so a fresh DB has no archived selection
-- and no AI features to suggest restoring.
--
-- Reversible by the matching .down.sql.

BEGIN;

INSERT INTO settings (key, value_jsonb, data_kind, description)
  VALUES (
    'ai_features_archived',
    '{}'::jsonb,
    'jsonb',
    'ADR-015 / Phase-50 F2: snapshot of the per-feature opt-in map at the moment ai_mode was set to ''off''. Surfaced in Settings → AI as an explicit "Restore previous selection?" suggestion when the user later switches back to local/cloud. Restore is NEVER silent.'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
