-- Migration 31: Add decimal_precision setting for user-controlled float formatting
ALTER TABLE settings ADD COLUMN IF NOT EXISTS decimal_precision INTEGER NOT NULL DEFAULT 1;
