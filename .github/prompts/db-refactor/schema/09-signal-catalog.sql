-- =========================================================================
-- 09 — signal_catalog (registry of every signal name ever seen)
-- ADR-009: backs the onboarding runbook. signal_observations FKs here.
-- =========================================================================

CREATE TABLE signal_catalog (
  name              text PRIMARY KEY,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  observation_count bigint      NOT NULL DEFAULT 0,
  storage_tier      text        NOT NULL DEFAULT 'cold'
                                CHECK (storage_tier IN ('hot','cold','dropped')),
  typed_table       text,
  typed_column      text,
  data_kind         text        CHECK (data_kind IN ('numeric','text','boolean','compound')),
  unit              text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  signal_catalog IS
  'Registry of every signal name ever seen. ADR-009 onboarding source of truth.';
COMMENT ON COLUMN signal_catalog.storage_tier IS
  'hot = promoted to a typed column; cold = stored in signal_observations; dropped = silently skipped at ingest.';
COMMENT ON COLUMN signal_catalog.typed_table IS
  'Populated when storage_tier=hot. NULL otherwise.';
COMMENT ON COLUMN signal_catalog.typed_column IS
  'Populated when storage_tier=hot. NULL otherwise.';
COMMENT ON COLUMN signal_catalog.data_kind IS
  'Hint for which value_* column in signal_observations is populated.';

CREATE TRIGGER signal_catalog_set_updated_at
  BEFORE UPDATE ON signal_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_signal_catalog_tier_count
  ON signal_catalog (storage_tier, observation_count DESC);
