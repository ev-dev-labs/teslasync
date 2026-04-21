-- Migration 31 (down): Remove decimal_precision setting
ALTER TABLE settings DROP COLUMN IF EXISTS decimal_precision;
