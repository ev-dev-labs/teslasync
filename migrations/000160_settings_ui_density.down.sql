-- Reverse Phase 40 / Prompt 44: remove the seeded ui_density row.
-- SettingsRepo defaults take over for fresh reads after rollback.
DELETE FROM settings WHERE key = 'ui_density';
