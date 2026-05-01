-- Reverse Phase 40 / Prompt 32: remove the seeded tab-badge rows.
-- SettingsRepo defaults take over for fresh reads after rollback.
DELETE FROM settings WHERE key IN ('tab_badge_enabled', 'critical_flash_enabled');
