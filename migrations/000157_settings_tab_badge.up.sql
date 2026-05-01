-- Phase 40 / Prompt 32: seed defaults for browser tab badge settings.
--
-- The `settings` table is a typed key/value store (ADR-011 Option A);
-- no schema change is required to add new logical fields. This
-- migration just seeds default rows so the first GET /settings after
-- the upgrade returns the new toggles enabled, matching the defaults
-- baked into SettingsRepo.settingsDefaults().
INSERT INTO settings (key, value_bool, data_kind)
VALUES
  ('tab_badge_enabled',      TRUE, 'boolean'),
  ('critical_flash_enabled', TRUE, 'boolean')
ON CONFLICT (key) DO NOTHING;
