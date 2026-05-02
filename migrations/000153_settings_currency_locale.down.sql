-- Reverse Phase 40 / Prompt 21: remove the seeded currency_symbol + locale
-- rows. SettingsRepo defaults will then take over for fresh reads.
DELETE FROM settings WHERE key IN ('currency_symbol', 'locale');
