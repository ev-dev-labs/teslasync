-- Geofence-based charging-place pricing.
--
-- Geofences become first-class "charging places": they gain discovery
-- provenance (origin/needs_review/archived_at) and an effective-dated,
-- immutable-once-active electricity-rate history (geofence_rates) so a session
-- priced under an old rate keeps that price forever after the rate changes.
--
-- SI discipline: the canonical rate column is `rate_per_wh` (NOT
-- `rate_per_kwh` / `cost_per_kwh`). The UI converts to currency/kWh only at
-- the render/request boundary (ADR-001/ADR-005).
--
-- btree_gist was installed by migration 000221_small_fleet_operations; this
-- migration reuses it for the no-overlap exclusion constraint below and does
-- NOT re-drop it in the down migration (owned by 000221).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Reconcile the abandoned migrations/000004_geofence_electricity_cost
--    precursor. Every database migrates sequentially from 000001, so 000004
--    always runs and creates the legacy `geofence_electricity_rates` table
--    (no `currency` column, `cost_per_kwh` instead of `rate_per_wh`).
--    migrations/000142_baseline_typed then DROPped+recreated `geofences`
--    (CASCADE), which removes the `cost_per_kwh` column and the FK from
--    `geofence_electricity_rates` onto `geofences`, but does NOT drop
--    `geofence_electricity_rates` itself — CASCADE on the *referenced* table
--    only drops constraints that depend on it, not the dependent table, so
--    the orphaned (FK-less) legacy table survives into every database that
--    has migrated through 000142+. Both this expected path and a
--    hypothetical already-reconciled database (this migration re-run, or a
--    hand-rolled schema with neither artifact) are handled so the migration
--    is idempotent and safe regardless of prior state.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    legacy_rate_table_exists boolean;
    legacy_rate_has_currency boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'geofence_electricity_rates'
    ) INTO legacy_rate_table_exists;

    IF legacy_rate_table_exists THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'geofence_electricity_rates'
              AND column_name = 'currency'
        ) INTO legacy_rate_has_currency;

        -- Only the pre-canonical shape (no `currency` column, `cost_per_kwh`
        -- instead of `rate_per_wh`) needs a data migration. If a later run of
        -- this same migration already renamed it to the canonical shape,
        -- legacy_rate_has_currency is true and nothing further happens here.
        IF NOT legacy_rate_has_currency THEN
            ALTER TABLE geofence_electricity_rates
                RENAME TO geofence_electricity_rates_legacy_000004;
        END IF;
    END IF;

    -- `geofences.cost_per_kwh` cannot survive migration 000142's
    -- DROP+recreate on any sequentially-migrated database, but a defensive
    -- drop documents the intent and protects a hand-rolled/partial schema.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'geofences'
          AND column_name = 'cost_per_kwh'
    ) THEN
        ALTER TABLE geofences DROP COLUMN cost_per_kwh;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Geofence discovery/lifecycle metadata.
-- ---------------------------------------------------------------------------
ALTER TABLE geofences
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'geofences_origin_valid'
    ) THEN
        ALTER TABLE geofences
            ADD CONSTRAINT geofences_origin_valid
            CHECK (origin IN ('manual', 'charging_discovery'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS geofences_needs_review_idx
    ON geofences (id) WHERE needs_review AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS geofences_archived_idx
    ON geofences (archived_at) WHERE archived_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Canonical effective-dated electricity rate history.
--
--    Half-open [effective_from, effective_to) intervals with a GIST
--    exclusion constraint preventing overlapping versions per geofence —
--    same pattern as fleet_charging_policies (migration 000221). The
--    current rate for a geofence is simply the row where effective_to IS
--    NULL (or the row whose interval contains "now"); there is deliberately
--    no separate mutable "current rate" column to keep one source of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geofence_rates (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    geofence_id     bigint      NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    -- NUMERIC(20,10): a currency/kWh rate as small as 0.0001 (=1e-7/Wh) and
    -- as large as a hyperinflated-currency rate both fit comfortably, and
    -- Postgres NUMERIC arithmetic (not Go float64) is used for cost math.
    rate_per_wh     NUMERIC(20,10) NOT NULL CHECK (rate_per_wh >= 0 AND rate_per_wh < 1000000),
    currency        char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    effective_from  timestamptz NOT NULL,
    effective_to    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT geofence_rates_period_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT geofence_rates_no_overlap EXCLUDE USING gist (
        geofence_id WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS geofence_rates_geofence_effective_idx
    ON geofence_rates (geofence_id, effective_from DESC);
-- Fast lookup of the unbounded interval. It may be future-scheduled, so
-- callers still test effective_from <= their query instant.
CREATE INDEX IF NOT EXISTS geofence_rates_open_idx
    ON geofence_rates (geofence_id) WHERE effective_to IS NULL;

-- Import any usable rows from the legacy pre-canonical shape now that the
-- canonical table exists. cost_per_kwh / 1000 = rate_per_wh (Wh = kWh/1000).
-- The legacy schema had no currency column, so imported rows default to USD
-- — the historical global default before this feature existed. Orphaned
-- rows (geofence_id no longer present, because 000142's CASCADE dropped the
-- old FK without deleting dependent rows) are skipped via the join.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'geofence_electricity_rates_legacy_000004'
    ) THEN
        INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from, effective_to, created_at)
        SELECT g.id,
               LEAST(GREATEST(legacy.cost_per_kwh / 1000.0, 0), 999999.9999999999),
               'USD',
               legacy.effective_from,
               legacy.effective_to,
               COALESCE(legacy.created_at, legacy.effective_from)
        FROM geofence_electricity_rates_legacy_000004 legacy
        JOIN geofences g ON g.id = legacy.geofence_id
        WHERE legacy.cost_per_kwh IS NOT NULL
        ON CONFLICT DO NOTHING;

        DROP TABLE geofence_electricity_rates_legacy_000004;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Charging-session provenance. No FK on geofence_id/rate_id: these columns
--    are written from the async (post-completion) leg of the telemetry
--    charge tracker, which must never be blocked by a synchronous FK check
--    against a table it does not otherwise touch on the hot path (mirrors
--    the existing no-FK precedent between charging_telemetry and
--    charging_sessions.id).
-- ---------------------------------------------------------------------------
ALTER TABLE charging_sessions
    ADD COLUMN IF NOT EXISTS geofence_id bigint,
    ADD COLUMN IF NOT EXISTS rate_id bigint,
    ADD COLUMN IF NOT EXISTS cost_source text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'charging_sessions_cost_source_valid'
    ) THEN
        ALTER TABLE charging_sessions
            ADD CONSTRAINT charging_sessions_cost_source_valid
            CHECK (cost_source IS NULL OR cost_source IN
                ('manual', 'tesla_actual', 'geofence_tariff', 'default_estimate', 'unknown'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS charging_sessions_geofence_idx
    ON charging_sessions (geofence_id) WHERE geofence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS charging_sessions_rate_idx
    ON charging_sessions (rate_id) WHERE rate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS charging_sessions_cost_source_idx
    ON charging_sessions (cost_source) WHERE cost_source IS NOT NULL;

-- Preserve pre-feature costs whose exact origin was not recorded. They are
-- deliberately marked unknown (not geofence-derived), so repricing tools
-- treat them as protected actuals rather than overwriting them.
UPDATE charging_sessions
SET cost_source = 'unknown'
WHERE cost_decimal IS NOT NULL
  AND cost_source IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Drive start/end geofence attribution (match-only; no auto-create). No
--    FK for the same hot-path-adjacency reason as charging_sessions above —
--    drive endpoint resolution also runs off the synchronous ingest path.
-- ---------------------------------------------------------------------------
ALTER TABLE drives
    ADD COLUMN IF NOT EXISTS start_geofence_id bigint,
    ADD COLUMN IF NOT EXISTS end_geofence_id bigint;

CREATE INDEX IF NOT EXISTS drives_start_geofence_idx
    ON drives (start_geofence_id) WHERE start_geofence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS drives_end_geofence_idx
    ON drives (end_geofence_id) WHERE end_geofence_id IS NOT NULL;
