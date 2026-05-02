-- Phase 40 / Prompt 44: seed default for ui_density setting.
--
-- The `settings` table is a typed key/value store (ADR-011 Option A);
-- no schema change is required to add new logical fields. This
-- migration just seeds a default row so the first GET /settings after
-- the upgrade returns a sensible value matching the default baked into
-- SettingsRepo.settingsDefaults().
--
-- Allowed values: 'compact' | 'comfortable' | 'spacious'. Default is
-- 'comfortable' so existing users see no visual change.
INSERT INTO settings (key, value_text, data_kind)
VALUES
  ('ui_density', 'comfortable', 'text')
ON CONFLICT (key) DO NOTHING;
