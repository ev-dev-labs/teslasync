-- Privacy-preserving vehicle benchmarks.
--
-- Privacy contract:
--   * participation is explicit and scoped to one authenticated subject and
--     one vehicle;
--   * raw drives, locations and VINs are never copied into these tables;
--   * contributions contain only bounded, clipped aggregates derived by the
--     server from canonical session/aggregate tables;
--   * releases contain differentially-private histogram post-processing and
--     an epsilon ledger. A stable source-version key prevents refreshes from
--     spending budget or minting fresh noise.

CREATE TABLE IF NOT EXISTS privacy_benchmark_consents (
    id                 BIGSERIAL PRIMARY KEY,
    subject            TEXT NOT NULL REFERENCES auth_subjects(subject) ON DELETE CASCADE,
    vehicle_id         BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'revoked')),
    epsilon_budget     DOUBLE PRECISION NOT NULL DEFAULT 4.0
                       CHECK (epsilon_budget > 0 AND epsilon_budget <= 20),
    opted_in_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (subject, vehicle_id),
    UNIQUE (vehicle_id),
    CHECK (
        (status = 'active' AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS privacy_benchmark_consents_active
    ON privacy_benchmark_consents (status, vehicle_id)
    WHERE status = 'active';

COMMENT ON TABLE privacy_benchmark_consents IS
    'Explicit per-subject, per-vehicle benchmark opt-in. Revoked rows remain as minimal budget-accounting tombstones so re-opt-in cannot reset epsilon spend.';
COMMENT ON COLUMN privacy_benchmark_consents.subject IS
    'Opaque forward-auth subject. Never returned by the benchmark API or written to logs.';
COMMENT ON COLUMN privacy_benchmark_consents.vehicle_id IS
    'Unique vehicle scope. A vehicle can contribute at most once, preventing duplicate-driver contributions.';
COMMENT ON COLUMN privacy_benchmark_consents.epsilon_budget IS
    'Lifetime sequential-composition cap for overlapping benchmark periods.';

CREATE TABLE IF NOT EXISTS privacy_benchmark_contributions (
    id                              BIGSERIAL PRIMARY KEY,
    consent_id                      BIGINT NOT NULL REFERENCES privacy_benchmark_consents(id) ON DELETE CASCADE,
    period_start                    DATE NOT NULL,
    period_end                      DATE NOT NULL,
    model_family                    TEXT NOT NULL
                                    CHECK (model_family IN ('model_s', 'model_3', 'model_x', 'model_y', 'cybertruck', 'other', 'unknown')),
    model_year_bucket               SMALLINT NOT NULL
                                    CHECK (model_year_bucket = 0 OR (model_year_bucket BETWEEN 2000 AND 2100 AND model_year_bucket % 5 = 0)),
    degradation_pct                 DOUBLE PRECISION
                                    CHECK (degradation_pct BETWEEN 0 AND 30),
    efficiency_wh_per_km            DOUBLE PRECISION
                                    CHECK (efficiency_wh_per_km BETWEEN 80 AND 500),
    charging_reliability_pct        DOUBLE PRECISION
                                    CHECK (charging_reliability_pct BETWEEN 0 AND 100),
    operation_reliability_pct       DOUBLE PRECISION
                                    CHECK (operation_reliability_pct BETWEEN 0 AND 100),
    degradation_sample_count        INTEGER NOT NULL DEFAULT 0 CHECK (degradation_sample_count BETWEEN 0 AND 1000),
    efficiency_sample_count         INTEGER NOT NULL DEFAULT 0 CHECK (efficiency_sample_count BETWEEN 0 AND 1000),
    charging_sample_count           INTEGER NOT NULL DEFAULT 0 CHECK (charging_sample_count BETWEEN 0 AND 1000),
    operation_sample_count          INTEGER NOT NULL DEFAULT 0 CHECK (operation_sample_count BETWEEN 0 AND 1000),
    mechanism_version               SMALLINT NOT NULL CHECK (mechanism_version > 0),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (consent_id, period_start, period_end, mechanism_version),
    CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS privacy_benchmark_contributions_cohort_period
    ON privacy_benchmark_contributions
       (model_family, model_year_bucket, period_end DESC, mechanism_version);

COMMENT ON TABLE privacy_benchmark_contributions IS
    'Bounded per-vehicle aggregates only. Values are clipped to documented sensitivity bounds before INSERT; no trip, location, VIN, session, notification or command source row is copied.';
COMMENT ON COLUMN privacy_benchmark_contributions.efficiency_wh_per_km IS
    'Clipped canonical efficiency in Wh/km. Display conversion occurs only at the frontend boundary.';
COMMENT ON COLUMN privacy_benchmark_contributions.operation_reliability_pct IS
    'Clipped combined notification-delivery and vehicle-command success percentage.';

CREATE TABLE IF NOT EXISTS privacy_benchmark_releases (
    id                       BIGSERIAL PRIMARY KEY,
    period_start             DATE NOT NULL,
    period_end               DATE NOT NULL,
    model_family             TEXT NOT NULL
                             CHECK (model_family IN ('model_s', 'model_3', 'model_x', 'model_y', 'cybertruck', 'other', 'unknown')),
    model_year_bucket        SMALLINT NOT NULL
                             CHECK (model_year_bucket = 0 OR (model_year_bucket BETWEEN 2000 AND 2100 AND model_year_bucket % 5 = 0)),
    source_version_hash      BYTEA NOT NULL,
    mechanism_version        SMALLINT NOT NULL CHECK (mechanism_version > 0),
    minimum_cohort_size      SMALLINT NOT NULL CHECK (minimum_cohort_size >= 2),
    epsilon_spent            DOUBLE PRECISION NOT NULL DEFAULT 0
                             CHECK (epsilon_spent >= 0 AND epsilon_spent <= 4),
    suppressed               BOOLEAN NOT NULL DEFAULT FALSE,
    suppression_reason       TEXT
                             CHECK (suppression_reason IS NULL OR suppression_reason IN (
                                 'insufficient_cohort',
                                 'insufficient_metric_data',
                                 'privacy_budget_exhausted'
                             )),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (
        period_start,
        period_end,
        model_family,
        model_year_bucket,
        source_version_hash,
        mechanism_version
    ),
    CHECK (period_end > period_start),
    CHECK (
        (suppressed = FALSE AND suppression_reason IS NULL AND epsilon_spent > 0)
        OR (suppressed = TRUE AND suppression_reason IS NOT NULL AND epsilon_spent = 0)
    )
);

CREATE INDEX IF NOT EXISTS privacy_benchmark_releases_cohort_period
    ON privacy_benchmark_releases
       (model_family, model_year_bucket, period_end DESC, id DESC);

COMMENT ON TABLE privacy_benchmark_releases IS
    'Stable DP release identity. The same cohort/period/source version is reused, so refreshes never draw fresh noise or spend epsilon.';
COMMENT ON COLUMN privacy_benchmark_releases.source_version_hash IS
    'Internal SHA-256 of the sorted active consent IDs. It detects membership changes without persisting or exposing subjects.';

CREATE TABLE IF NOT EXISTS privacy_benchmark_release_metrics (
    release_id             BIGINT NOT NULL REFERENCES privacy_benchmark_releases(id) ON DELETE CASCADE,
    metric_name            TEXT NOT NULL
                           CHECK (metric_name IN (
                               'degradation_pct',
                               'efficiency_wh_per_km',
                               'charging_reliability_pct',
                               'operation_reliability_pct'
                           )),
    unit                   TEXT NOT NULL
                           CHECK (unit IN ('pct', 'wh_per_km')),
    lower_bound            DOUBLE PRECISION NOT NULL,
    upper_bound            DOUBLE PRECISION NOT NULL,
    epsilon_spent          DOUBLE PRECISION NOT NULL CHECK (epsilon_spent >= 0 AND epsilon_spent <= 1),
    noisy_cohort_size      INTEGER,
    noisy_mean             DOUBLE PRECISION,
    noisy_p25              DOUBLE PRECISION,
    noisy_p75              DOUBLE PRECISION,
    noise_scale            DOUBLE PRECISION,
    suppressed             BOOLEAN NOT NULL DEFAULT FALSE,
    quality                TEXT NOT NULL CHECK (quality IN ('suppressed', 'limited', 'moderate', 'strong')),
    PRIMARY KEY (release_id, metric_name),
    CHECK (upper_bound > lower_bound),
    CHECK (noisy_cohort_size IS NULL OR noisy_cohort_size >= 0),
    CHECK (noise_scale IS NULL OR noise_scale > 0),
    CHECK (
        (suppressed = TRUE
          AND epsilon_spent = 0
          AND noisy_cohort_size IS NULL
          AND noisy_mean IS NULL
          AND noisy_p25 IS NULL
          AND noisy_p75 IS NULL
          AND noise_scale IS NULL
          AND quality = 'suppressed')
        OR
        (suppressed = FALSE
          AND epsilon_spent > 0
          AND noisy_cohort_size IS NOT NULL
          AND noisy_mean IS NOT NULL
          AND noisy_p25 IS NOT NULL
          AND noisy_p75 IS NOT NULL
          AND noise_scale IS NOT NULL
          AND quality <> 'suppressed')
    )
);

COMMENT ON TABLE privacy_benchmark_release_metrics IS
    'Typed, normalized DP metric summaries. Quantiles and means are post-processing of fixed-bin noisy histograms.';

CREATE TABLE IF NOT EXISTS privacy_benchmark_release_bins (
    release_id     BIGINT NOT NULL,
    metric_name    TEXT NOT NULL,
    bin_index      SMALLINT NOT NULL CHECK (bin_index BETWEEN 0 AND 9),
    noisy_count    DOUBLE PRECISION NOT NULL CHECK (noisy_count >= 0),
    PRIMARY KEY (release_id, metric_name, bin_index),
    FOREIGN KEY (release_id, metric_name)
        REFERENCES privacy_benchmark_release_metrics(release_id, metric_name)
        ON DELETE CASCADE
);

COMMENT ON TABLE privacy_benchmark_release_bins IS
    'Fixed ten-bin histograms after crypto/rand Laplace noise and non-negative post-processing. No exact bin count is stored.';

CREATE TABLE IF NOT EXISTS privacy_benchmark_release_memberships (
    consent_id     BIGINT NOT NULL REFERENCES privacy_benchmark_consents(id) ON DELETE CASCADE,
    release_id     BIGINT NOT NULL REFERENCES privacy_benchmark_releases(id) ON DELETE CASCADE,
    PRIMARY KEY (consent_id, release_id)
);

CREATE INDEX IF NOT EXISTS privacy_benchmark_release_memberships_release
    ON privacy_benchmark_release_memberships (release_id);

COMMENT ON TABLE privacy_benchmark_release_memberships IS
    'Internal stable-release eligibility metadata, including suppressed releases. It contains no subject, VIN, location, trip or metric value.';

CREATE TABLE IF NOT EXISTS privacy_benchmark_privacy_ledger (
    id                    BIGSERIAL PRIMARY KEY,
    consent_id            BIGINT NOT NULL REFERENCES privacy_benchmark_consents(id) ON DELETE CASCADE,
    release_id            BIGINT NOT NULL REFERENCES privacy_benchmark_releases(id) ON DELETE CASCADE,
    epsilon_spent         DOUBLE PRECISION NOT NULL CHECK (epsilon_spent > 0 AND epsilon_spent <= 4),
    l1_sensitivity        DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (l1_sensitivity = 1.0),
    mechanism             TEXT NOT NULL DEFAULT 'laplace_fixed_histogram_v1'
                          CHECK (mechanism = 'laplace_fixed_histogram_v1'),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (consent_id, release_id)
);

CREATE INDEX IF NOT EXISTS privacy_benchmark_ledger_consent
    ON privacy_benchmark_privacy_ledger (consent_id, created_at DESC);

COMMENT ON TABLE privacy_benchmark_privacy_ledger IS
    'Sequential-composition ledger. One row per contributing consent and stable release; UNIQUE prevents refresh double-spend.';
