-- =========================================================================
-- 01 — vehicles + shared set_updated_at() trigger fn
-- ADR-001: typed-by-default. The set_updated_at fn is the ONE shared
-- pl/pgsql artifact this schema keeps; every other table installs a
-- BEFORE UPDATE trigger that calls it.
-- =========================================================================

-- Shared trigger fn — used by every non-append-only table
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Shared BEFORE UPDATE trigger function. Maintains updated_at on every '
  'non-append-only table. Defined once in 01-vehicles.sql.';

-- Root entity
CREATE TABLE vehicles (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tesla_id        bigint      NOT NULL UNIQUE,
  vin             text        NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  model           text,
  option_codes    text,
  color           text,
  trim_level      text,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  vehicles                 IS 'Root entity. Every FK in the schema chains back here.';
COMMENT ON COLUMN vehicles.tesla_id        IS 'Tesla Fleet API vehicle id. Distinct from our surrogate id.';
COMMENT ON COLUMN vehicles.vin             IS 'Vehicle Identification Number — 17 chars, but stored as text to tolerate Tesla format changes.';
COMMENT ON COLUMN vehicles.option_codes    IS 'Comma-separated option codes from Fleet API; opaque, never parsed in queries.';
COMMENT ON COLUMN vehicles.archived_at     IS 'Soft-delete marker. Active queries should add WHERE archived_at IS NULL.';

CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vehicles_active ON vehicles (id) WHERE archived_at IS NULL;
