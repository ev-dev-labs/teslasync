BEGIN;

-- ---------------------------------------------------------------------------
-- Ownership Intelligence suite.
--
-- Ten independent products share one migration because they are introduced as
-- a single bounded context (internal/*/ownershipintel). Every table is
-- subject-scoped exactly like action_center_states: forward-auth installs get
-- per-identity isolation, open-mode installs collapse onto one local subject.
--
-- Units are SI canonical per phase-48: distance in metres (_m), duration in
-- seconds (_s), energy in watt-hours (_wh), power in watts (_w), speed in
-- metres per second (_mps). Money is stored in ISO-4217 minor units (_minor)
-- so no floating point rounding can accumulate across aggregation.
-- ---------------------------------------------------------------------------

-- 1. Insurance telematics ----------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_policies (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    insurer               text        NOT NULL CHECK (char_length(insurer) BETWEEN 1 AND 160),
    policy_ref            text        NOT NULL DEFAULT '' CHECK (char_length(policy_ref) <= 160),
    currency              char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    annual_premium_minor  bigint      NOT NULL CHECK (annual_premium_minor >= 0),
    deductible_minor      bigint      NOT NULL DEFAULT 0 CHECK (deductible_minor >= 0),
    coverage_start        timestamptz NOT NULL,
    coverage_end          timestamptz,
    telematics_program    boolean     NOT NULL DEFAULT false,
    max_discount_pct      real        NOT NULL DEFAULT 30
                                      CHECK (max_discount_pct >= 0 AND max_discount_pct <= 60),
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT insurance_policies_window CHECK (
        coverage_end IS NULL OR coverage_end > coverage_start
    ),
    CONSTRAINT insurance_policies_unique_ref UNIQUE (subject, vehicle_id, insurer, policy_ref)
);

CREATE INDEX IF NOT EXISTS insurance_policies_subject_vehicle_idx
    ON insurance_policies (subject, vehicle_id, coverage_start DESC);

-- 2. Utility tariff arbitrage ------------------------------------------------

CREATE TABLE IF NOT EXISTS utility_tariffs (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                   text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    name                      text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    provider                  text        NOT NULL DEFAULT '' CHECK (char_length(provider) <= 160),
    currency                  char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    structure                 text        NOT NULL
                                          CHECK (structure IN ('flat', 'tou', 'tiered', 'real_time', 'demand')),
    standing_charge_minor_per_day  numeric(18, 6) NOT NULL DEFAULT 0
                                          CHECK (standing_charge_minor_per_day >= 0),
    demand_charge_minor_per_w numeric(20, 10) NOT NULL DEFAULT 0
                                          CHECK (demand_charge_minor_per_w >= 0),
    export_price_minor_per_wh numeric(20, 10) NOT NULL DEFAULT 0
                                          CHECK (export_price_minor_per_wh >= 0),
    is_current                boolean     NOT NULL DEFAULT false,
    version                   integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT utility_tariffs_unique_name UNIQUE (subject, name)
);

CREATE TABLE IF NOT EXISTS utility_tariff_rates (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tariff_id             bigint      NOT NULL REFERENCES utility_tariffs (id) ON DELETE CASCADE,
    label                 text        NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
    -- day_mask bit 0 = Sunday .. bit 6 = Saturday. 127 = every day.
    day_mask              integer     NOT NULL DEFAULT 127
                                      CHECK (day_mask BETWEEN 1 AND 127),
    start_minute          integer     NOT NULL DEFAULT 0 CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute            integer     NOT NULL DEFAULT 1440 CHECK (end_minute BETWEEN 1 AND 1440),
    price_minor_per_wh    numeric(20, 10) NOT NULL CHECK (price_minor_per_wh >= 0),
    tier_upper_wh         double precision CHECK (tier_upper_wh IS NULL OR tier_upper_wh > 0),
    season_start_month    smallint    NOT NULL DEFAULT 1 CHECK (season_start_month BETWEEN 1 AND 12),
    season_end_month      smallint    NOT NULL DEFAULT 12 CHECK (season_end_month BETWEEN 1 AND 12),
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT utility_tariff_rates_window CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS utility_tariff_rates_tariff_idx
    ON utility_tariff_rates (tariff_id, start_minute);
CREATE INDEX IF NOT EXISTS utility_tariffs_subject_idx
    ON utility_tariffs (subject, updated_at DESC);

-- 3. Charging invoice reconciliation -----------------------------------------

CREATE TABLE IF NOT EXISTS charging_invoices (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    provider              text        NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 160),
    invoice_ref           text        NOT NULL CHECK (char_length(invoice_ref) BETWEEN 1 AND 160),
    currency              char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    period_start          timestamptz NOT NULL,
    period_end            timestamptz NOT NULL,
    billed_total_minor    bigint      NOT NULL CHECK (billed_total_minor >= 0),
    status                text        NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'reconciled', 'disputed', 'settled')),
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT charging_invoices_window CHECK (period_end > period_start),
    CONSTRAINT charging_invoices_unique_ref UNIQUE (subject, provider, invoice_ref)
);

CREATE TABLE IF NOT EXISTS charging_invoice_lines (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id            bigint      NOT NULL REFERENCES charging_invoices (id) ON DELETE CASCADE,
    line_ref              text        NOT NULL DEFAULT '' CHECK (char_length(line_ref) <= 160),
    occurred_at           timestamptz NOT NULL,
    location              text        NOT NULL DEFAULT '' CHECK (char_length(location) <= 240),
    billed_energy_wh      double precision NOT NULL CHECK (billed_energy_wh >= 0),
    billed_energy_minor   bigint      NOT NULL DEFAULT 0 CHECK (billed_energy_minor >= 0),
    billed_idle_minor     bigint      NOT NULL DEFAULT 0 CHECK (billed_idle_minor >= 0),
    billed_tax_minor      bigint      NOT NULL DEFAULT 0 CHECK (billed_tax_minor >= 0),
    billed_total_minor    bigint      NOT NULL CHECK (billed_total_minor >= 0),
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charging_invoice_disputes (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id            bigint      NOT NULL REFERENCES charging_invoices (id) ON DELETE CASCADE,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    claimed_minor         bigint      NOT NULL CHECK (claimed_minor >= 0),
    recovered_minor       bigint      NOT NULL DEFAULT 0 CHECK (recovered_minor >= 0),
    status                text        NOT NULL DEFAULT 'submitted'
                                      CHECK (status IN ('submitted', 'accepted', 'rejected', 'withdrawn')),
    reasons               text[]      NOT NULL DEFAULT ARRAY[]::text[],
    note                  text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
    opened_at             timestamptz NOT NULL DEFAULT now(),
    resolved_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS charging_invoices_subject_vehicle_idx
    ON charging_invoices (subject, vehicle_id, period_start DESC);
CREATE INDEX IF NOT EXISTS charging_invoice_lines_invoice_idx
    ON charging_invoice_lines (invoice_id, occurred_at);
CREATE INDEX IF NOT EXISTS charging_invoice_disputes_invoice_idx
    ON charging_invoice_disputes (invoice_id, opened_at DESC);

-- 4. Driver fingerprinting and attribution -----------------------------------

CREATE TABLE IF NOT EXISTS driver_profiles (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    name                  text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    accent                text        NOT NULL DEFAULT 'cyan'
                                      CHECK (accent IN ('cyan', 'emerald', 'amber', 'rose', 'violet', 'sky')),
    is_primary            boolean     NOT NULL DEFAULT false,
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT driver_profiles_unique_name UNIQUE (subject, vehicle_id, name)
);

CREATE TABLE IF NOT EXISTS drive_driver_assignments (
    drive_id              bigint      NOT NULL REFERENCES drives (id) ON DELETE CASCADE,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    driver_profile_id     bigint      NOT NULL REFERENCES driver_profiles (id) ON DELETE CASCADE,
    source                text        NOT NULL CHECK (source IN ('manual', 'inferred')),
    confidence_pct        real        NOT NULL DEFAULT 100
                                      CHECK (confidence_pct >= 0 AND confidence_pct <= 100),
    assigned_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, drive_id)
);

CREATE INDEX IF NOT EXISTS driver_profiles_subject_vehicle_idx
    ON driver_profiles (subject, vehicle_id, created_at);
CREATE INDEX IF NOT EXISTS drive_driver_assignments_profile_idx
    ON drive_driver_assignments (driver_profile_id, assigned_at DESC);

-- 5. Warranty coverage and claim readiness -----------------------------------

CREATE TABLE IF NOT EXISTS vehicle_warranties (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    kind                  text        NOT NULL
                                      CHECK (kind IN ('basic', 'drivetrain', 'battery', 'corrosion',
                                                      'tires', 'aftermarket', 'extended')),
    label                 text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
    provider              text        NOT NULL DEFAULT '' CHECK (char_length(provider) <= 160),
    start_at              timestamptz NOT NULL,
    start_odometer_m      double precision NOT NULL DEFAULT 0 CHECK (start_odometer_m >= 0),
    term_s                bigint      NOT NULL CHECK (term_s > 0),
    term_distance_m       double precision NOT NULL CHECK (term_distance_m > 0),
    capacity_floor_pct    real        CHECK (capacity_floor_pct IS NULL OR
                                             (capacity_floor_pct > 0 AND capacity_floor_pct <= 100)),
    deductible_minor      bigint      NOT NULL DEFAULT 0 CHECK (deductible_minor >= 0),
    currency              char(3)     NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    notes                 text        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vehicle_warranties_unique_label UNIQUE (subject, vehicle_id, label)
);

CREATE TABLE IF NOT EXISTS warranty_claims (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warranty_id           bigint      NOT NULL REFERENCES vehicle_warranties (id) ON DELETE CASCADE,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    title                 text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    status                text        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'submitted', 'approved', 'denied', 'closed')),
    opened_at             timestamptz NOT NULL DEFAULT now(),
    closed_at             timestamptz,
    amount_minor          bigint      NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    evidence_note         text        NOT NULL DEFAULT '' CHECK (char_length(evidence_note) <= 4000),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_warranties_subject_vehicle_idx
    ON vehicle_warranties (subject, vehicle_id, start_at DESC);
CREATE INDEX IF NOT EXISTS warranty_claims_warranty_idx
    ON warranty_claims (warranty_id, opened_at DESC);

-- 6. Data retention and lifecycle governance ---------------------------------

CREATE TABLE IF NOT EXISTS retention_policies (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    dataset               text        NOT NULL CHECK (char_length(dataset) BETWEEN 1 AND 120),
    retention_s           bigint      NOT NULL CHECK (retention_s >= 86400),
    downsample_after_s    bigint      CHECK (downsample_after_s IS NULL OR downsample_after_s >= 86400),
    downsample_bucket_s   bigint      CHECK (downsample_bucket_s IS NULL OR downsample_bucket_s >= 60),
    legal_hold            boolean     NOT NULL DEFAULT false,
    enabled               boolean     NOT NULL DEFAULT true,
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT retention_policies_unique_dataset UNIQUE (subject, dataset),
    CONSTRAINT retention_policies_downsample_pair CHECK (
        (downsample_after_s IS NULL AND downsample_bucket_s IS NULL) OR
        (downsample_after_s IS NOT NULL AND downsample_bucket_s IS NOT NULL)
    ),
    CONSTRAINT retention_policies_downsample_before_retention CHECK (
        downsample_after_s IS NULL OR downsample_after_s < retention_s
    )
);

CREATE TABLE IF NOT EXISTS retention_runs (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    dataset               text        NOT NULL CHECK (char_length(dataset) BETWEEN 1 AND 120),
    mode                  text        NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run')),
    rows_scanned          bigint      NOT NULL DEFAULT 0 CHECK (rows_scanned >= 0),
    rows_expiring         bigint      NOT NULL DEFAULT 0 CHECK (rows_expiring >= 0),
    rows_downsampling     bigint      NOT NULL DEFAULT 0 CHECK (rows_downsampling >= 0),
    bytes_reclaimable     bigint      NOT NULL DEFAULT 0 CHECK (bytes_reclaimable >= 0),
    fidelity_loss_pct     real        NOT NULL DEFAULT 0
                                      CHECK (fidelity_loss_pct >= 0 AND fidelity_loss_pct <= 100),
    blocked_by_hold       boolean     NOT NULL DEFAULT false,
    executed_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retention_policies_subject_idx
    ON retention_policies (subject, dataset);
CREATE INDEX IF NOT EXISTS retention_runs_subject_idx
    ON retention_runs (subject, executed_at DESC, id DESC);

-- 7. Prediction accuracy and model trust -------------------------------------

CREATE TABLE IF NOT EXISTS model_predictions (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    model_name            text        NOT NULL CHECK (char_length(model_name) BETWEEN 1 AND 120),
    target                text        NOT NULL CHECK (char_length(target) BETWEEN 1 AND 120),
    si_unit               text        NOT NULL DEFAULT '' CHECK (char_length(si_unit) <= 24),
    predicted_at          timestamptz NOT NULL,
    horizon_s             bigint      NOT NULL CHECK (horizon_s > 0),
    predicted_value       double precision NOT NULL,
    predicted_low         double precision,
    predicted_high        double precision,
    reference             text        NOT NULL DEFAULT '' CHECK (char_length(reference) <= 160),
    observed_value        double precision,
    observed_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT model_predictions_interval CHECK (
        predicted_low IS NULL OR predicted_high IS NULL OR predicted_high >= predicted_low
    ),
    CONSTRAINT model_predictions_outcome_pair CHECK (
        (observed_value IS NULL AND observed_at IS NULL) OR
        (observed_value IS NOT NULL AND observed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS model_predictions_scorecard_idx
    ON model_predictions (subject, vehicle_id, model_name, predicted_at DESC);
CREATE INDEX IF NOT EXISTS model_predictions_pending_idx
    ON model_predictions (subject, vehicle_id, predicted_at DESC)
    WHERE observed_value IS NULL;

-- 8. Jurisdictional compliance and road-usage charge -------------------------

CREATE TABLE IF NOT EXISTS jurisdiction_rates (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                   text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    jurisdiction_code         text        NOT NULL CHECK (jurisdiction_code ~ '^[A-Z0-9-]{2,12}$'),
    label                     text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
    currency                  char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    road_usage_minor_per_m    numeric(20, 10) NOT NULL DEFAULT 0 CHECK (road_usage_minor_per_m >= 0),
    registration_fee_minor    bigint      NOT NULL DEFAULT 0 CHECK (registration_fee_minor >= 0),
    grid_intensity_g_per_wh   double precision NOT NULL DEFAULT 0 CHECK (grid_intensity_g_per_wh >= 0),
    min_lat                   double precision NOT NULL CHECK (min_lat BETWEEN -90 AND 90),
    max_lat                   double precision NOT NULL CHECK (max_lat BETWEEN -90 AND 90),
    min_lng                   double precision NOT NULL CHECK (min_lng BETWEEN -180 AND 180),
    max_lng                   double precision NOT NULL CHECK (max_lng BETWEEN -180 AND 180),
    version                   integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jurisdiction_rates_bbox CHECK (max_lat > min_lat AND max_lng > min_lng),
    CONSTRAINT jurisdiction_rates_unique_code UNIQUE (subject, jurisdiction_code)
);

CREATE TABLE IF NOT EXISTS compliance_filings (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    period_start          timestamptz NOT NULL,
    period_end            timestamptz NOT NULL,
    status                text        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'filed', 'amended')),
    total_distance_m      double precision NOT NULL CHECK (total_distance_m >= 0),
    total_energy_wh       double precision NOT NULL CHECK (total_energy_wh >= 0),
    total_charge_minor    bigint      NOT NULL DEFAULT 0 CHECK (total_charge_minor >= 0),
    currency              char(3)     NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    digest                text        NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    snapshot              jsonb       NOT NULL,
    filed_at              timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_filings_window CHECK (period_end > period_start),
    CONSTRAINT compliance_filings_unique_period UNIQUE (subject, vehicle_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS jurisdiction_rates_subject_idx
    ON jurisdiction_rates (subject, jurisdiction_code);
CREATE INDEX IF NOT EXISTS compliance_filings_subject_vehicle_idx
    ON compliance_filings (subject, vehicle_id, period_start DESC);

-- 9. Consumables and wear parts ----------------------------------------------

CREATE TABLE IF NOT EXISTS consumable_items (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id             bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    category               text        NOT NULL
                                       CHECK (category IN ('tire', 'cabin_filter', 'hepa_filter', 'wiper',
                                                           'brake_fluid', 'coolant', 'brake_pad',
                                                           'suspension', 'key_battery', 'other')),
    label                  text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
    position               text        NOT NULL DEFAULT '' CHECK (char_length(position) <= 40),
    installed_at           timestamptz NOT NULL,
    installed_odometer_m   double precision NOT NULL DEFAULT 0 CHECK (installed_odometer_m >= 0),
    rated_life_m           double precision CHECK (rated_life_m IS NULL OR rated_life_m > 0),
    rated_life_s           bigint      CHECK (rated_life_s IS NULL OR rated_life_s > 0),
    cost_minor             bigint      NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
    currency               char(3)     NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    retired_at             timestamptz,
    notes                  text        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
    version                integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT consumable_items_rated_life_present CHECK (
        rated_life_m IS NOT NULL OR rated_life_s IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS consumable_events (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id               bigint      NOT NULL REFERENCES consumable_items (id) ON DELETE CASCADE,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    kind                  text        NOT NULL CHECK (kind IN ('inspect', 'rotate', 'service', 'replace', 'note')),
    occurred_at           timestamptz NOT NULL,
    odometer_m            double precision CHECK (odometer_m IS NULL OR odometer_m >= 0),
    cost_minor            bigint      NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
    note                  text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consumable_items_subject_vehicle_idx
    ON consumable_items (subject, vehicle_id, installed_at DESC);
CREATE INDEX IF NOT EXISTS consumable_events_item_idx
    ON consumable_events (item_id, occurred_at DESC);

-- 10. Subscription and paid-feature ROI --------------------------------------

CREATE TABLE IF NOT EXISTS vehicle_subscriptions (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject               text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id            bigint      NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
    name                  text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    kind                  text        NOT NULL CHECK (kind IN ('subscription', 'one_time')),
    billing_period        text        NOT NULL CHECK (billing_period IN ('monthly', 'annual', 'once')),
    price_minor           bigint      NOT NULL CHECK (price_minor >= 0),
    currency              char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    usage_metric          text        NOT NULL
                                      CHECK (usage_metric IN ('supercharging_energy', 'driving_distance',
                                                              'connectivity_time', 'charging_sessions',
                                                              'drive_count', 'none')),
    benchmark_minor_per_unit numeric(20, 10) NOT NULL DEFAULT 0
                                      CHECK (benchmark_minor_per_unit >= 0),
    started_at            timestamptz NOT NULL,
    ended_at              timestamptz,
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vehicle_subscriptions_window CHECK (ended_at IS NULL OR ended_at > started_at),
    CONSTRAINT vehicle_subscriptions_unique_name UNIQUE (subject, vehicle_id, name),
    CONSTRAINT vehicle_subscriptions_billing_kind CHECK (
        (kind = 'one_time' AND billing_period = 'once') OR
        (kind = 'subscription' AND billing_period IN ('monthly', 'annual'))
    )
);

CREATE INDEX IF NOT EXISTS vehicle_subscriptions_subject_vehicle_idx
    ON vehicle_subscriptions (subject, vehicle_id, started_at DESC);

COMMENT ON TABLE insurance_policies IS
    'Subject-scoped insurance policy baselines used to convert telematics risk indices into premium simulations.';
COMMENT ON TABLE utility_tariffs IS
    'User-authored electricity tariff definitions replayed against measured charging load by the tariff arbitrage lab.';
COMMENT ON TABLE charging_invoices IS
    'Provider charging invoices reconciled line-by-line against measured charging_sessions.';
COMMENT ON TABLE driver_profiles IS
    'Named driver identities that per-drive behavioural fingerprints are attributed to.';
COMMENT ON TABLE vehicle_warranties IS
    'Warranty term definitions (time, distance, and capacity floor) used for coverage countdown and claim readiness.';
COMMENT ON TABLE retention_policies IS
    'Plan-only data lifecycle policies. TeslaSync never deletes data automatically; runs are dry-run impact simulations.';
COMMENT ON TABLE model_predictions IS
    'Platform forecasts joined to realised outcomes so model bias, calibration, and drift can be scored.';
COMMENT ON TABLE jurisdiction_rates IS
    'Bounding-box jurisdiction definitions with road-usage-charge and grid-intensity rates for compliance apportionment.';
COMMENT ON TABLE consumable_items IS
    'Wear parts with rated life used for duty-cycle adjusted depletion modelling.';
COMMENT ON TABLE vehicle_subscriptions IS
    'Paid features and subscriptions scored against telemetry-backed realised usage.';

COMMIT;
