-- Phase 40 / Prompt 21: seed defaults for currency_symbol + locale settings.
--
-- The `settings` table is a typed key/value store (ADR-011 Option A); no
-- schema change is required to add new logical fields. This migration just
-- seeds default rows so first-load reads return something sensible without
-- relying on the application-level defaults baked into SettingsRepo.
INSERT INTO settings (key, value_text, data_kind)
VALUES
  ('currency_symbol', '$',     'text'),
  ('locale',          'en-US', 'text')
ON CONFLICT (key) DO NOTHING;
