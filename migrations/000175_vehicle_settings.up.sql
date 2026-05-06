-- Phase-46 / Prompt 43 — Per-vehicle settings layer.
--
-- Today every TeslaSync setting (units, charge cost, mute window, …) is
-- install-global. Multi-vehicle owners who keep, e.g., a metric Model 3
-- and an imperial Model Y in the same household can't express the
-- difference without rewriting the global record before each visit.
--
-- This table records the per-vehicle OVERRIDES; the resolver in
-- internal/database/vehicle_settings_resolver.go layers a row here on
-- top of the existing user-/install-level setting and the hard-coded
-- default. Absence of a row means "fall back" — there is no row when
-- the vehicle is happy with the user-level value.
--
-- Schema mirrors the existing `settings` table (migration 000142) so
-- callers can apply the same `data_kind`-discriminated decoder. We add
-- a `value_ts` column so RFC3339 timestamps (mute_until) can be stored
-- without losing timezone information through TEXT/EPOCH round-trips.
--
-- ON DELETE CASCADE: when a vehicle is hard-deleted, every override row
-- collected for it goes with it — there is no value in keeping orphan
-- overrides keyed by a vehicle id that no longer resolves.

CREATE TABLE IF NOT EXISTS vehicle_settings (
    vehicle_id  BIGINT      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    setting_key TEXT        NOT NULL,
    -- Exactly one of the value_* columns is meaningful, selected by
    -- data_kind. The repo's Upsert path NULLs the other three on every
    -- write so a stale carrier column never leaks through if a key
    -- changes type in a later migration.
    value_text  TEXT,
    value_num   DOUBLE PRECISION,
    value_bool  BOOLEAN,
    value_ts    TIMESTAMPTZ,
    data_kind   TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, setting_key),
    -- The repo enforces this whitelist at the application layer too;
    -- keep both in sync because the CHECK constraint catches a buggy
    -- INSERT path that bypassed the repo (e.g. a future migration).
    CONSTRAINT vehicle_settings_data_kind_chk
        CHECK (data_kind IN ('text', 'number', 'boolean', 'timestamp'))
);

-- Per-vehicle lookup (the only access pattern). The PRIMARY KEY already
-- indexes (vehicle_id, setting_key), so no additional index is needed.
