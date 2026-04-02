-- Migration 12: Theme settings
-- Wrapped in DO block for transactional safety with golang-migrate.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='theme') THEN
    ALTER TABLE settings ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'neon-cyan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='mode') THEN
    ALTER TABLE settings ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'dark';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='custom_primary') THEN
    ALTER TABLE settings ADD COLUMN custom_primary VARCHAR(10) NOT NULL DEFAULT '#00b4d8';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='custom_accent') THEN
    ALTER TABLE settings ADD COLUMN custom_accent VARCHAR(10) NOT NULL DEFAULT '#e63946';
  END IF;
END
$$;

