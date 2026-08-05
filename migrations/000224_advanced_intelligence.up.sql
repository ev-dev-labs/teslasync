BEGIN;

CREATE TABLE IF NOT EXISTS advanced_federated_model_cards (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                 text             NOT NULL
                                             CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id              bigint           NOT NULL
                                             REFERENCES vehicles(id) ON DELETE CASCADE,
    model_name              text             NOT NULL
                                             CHECK (char_length(btrim(model_name)) BETWEEN 1 AND 120),
    model_version           text             NOT NULL
                                             CHECK (char_length(btrim(model_version)) BETWEEN 1 AND 64),
    task                    text             NOT NULL
                                             CHECK (task IN ('efficiency')),
    version                 integer          NOT NULL DEFAULT 1 CHECK (version > 0),
    epsilon_budget          double precision NOT NULL
                                             CHECK (epsilon_budget > 0 AND epsilon_budget <= 20),
    epsilon_spent           double precision NOT NULL DEFAULT 0
                                             CHECK (epsilon_spent >= 0 AND epsilon_spent <= epsilon_budget),
    round_count             integer          NOT NULL DEFAULT 0 CHECK (round_count >= 0),
    latest_sample_count     integer          CHECK (latest_sample_count IS NULL OR latest_sample_count >= 0),
    latest_metric_wh_per_m  double precision CHECK (
                                                latest_metric_wh_per_m IS NULL OR
                                                latest_metric_wh_per_m >= 0
                                             ),
    latest_status           text             CHECK (
                                                latest_status IS NULL OR
                                                latest_status IN ('completed', 'insufficient')
                                             ),
    created_at              timestamptz      NOT NULL DEFAULT now(),
    updated_at              timestamptz      NOT NULL DEFAULT now(),
    UNIQUE (subject, vehicle_id, model_name, model_version)
);

CREATE TABLE IF NOT EXISTS advanced_federated_rounds (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_card_id          bigint           NOT NULL
                                            REFERENCES advanced_federated_model_cards(id) ON DELETE CASCADE,
    round_number           integer          NOT NULL CHECK (round_number > 0),
    requested_epsilon      double precision NOT NULL
                                            CHECK (requested_epsilon > 0 AND requested_epsilon <= 5),
    epsilon_spent          double precision NOT NULL
                                            CHECK (epsilon_spent >= 0 AND epsilon_spent <= requested_epsilon),
    sample_count           integer          NOT NULL CHECK (sample_count >= 0),
    local_metric_wh_per_m  double precision CHECK (
                                               local_metric_wh_per_m IS NULL OR
                                               local_metric_wh_per_m >= 0
                                            ),
    clipped_update_pct     double precision CHECK (
                                               clipped_update_pct IS NULL OR
                                               clipped_update_pct BETWEEN -100 AND 100
                                            ),
    status                 text             NOT NULL
                                            CHECK (status IN ('completed', 'insufficient')),
    started_at             timestamptz      NOT NULL,
    completed_at           timestamptz,
    UNIQUE (model_card_id, round_number),
    CONSTRAINT advanced_federated_round_completion CHECK (
        (status = 'completed' AND completed_at IS NOT NULL) OR
        (status = 'insufficient' AND completed_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS advanced_causal_experiments (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject            text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id         bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    intervention_kind  text        NOT NULL CHECK (
                                    intervention_kind IN (
                                        'charging_schedule',
                                        'tire_service',
                                        'software_update',
                                        'climate_preconditioning',
                                        'driving_policy'
                                    )
                                ),
    metric             text        NOT NULL CHECK (
                                    metric IN (
                                        'drive_energy_wh_per_m',
                                        'charging_success_pct',
                                        'average_speed_mps'
                                    )
                                ),
    baseline_start     timestamptz NOT NULL,
    baseline_end       timestamptz NOT NULL,
    treatment_start    timestamptz NOT NULL,
    treatment_end      timestamptz NOT NULL,
    state              text        NOT NULL
                                    CHECK (state IN ('estimated', 'non_causal', 'insufficient')),
    version            integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT advanced_causal_baseline_window CHECK (baseline_end > baseline_start),
    CONSTRAINT advanced_causal_treatment_window CHECK (treatment_end > treatment_start),
    CONSTRAINT advanced_causal_windows_ordered CHECK (treatment_start >= baseline_end)
);

CREATE TABLE IF NOT EXISTS advanced_causal_results (
    experiment_id             bigint           PRIMARY KEY
                                              REFERENCES advanced_causal_experiments(id) ON DELETE CASCADE,
    baseline_sample_count     integer          NOT NULL CHECK (baseline_sample_count >= 0),
    treatment_sample_count    integer          NOT NULL CHECK (treatment_sample_count >= 0),
    confounder_coverage_pct   double precision CHECK (
                                                 confounder_coverage_pct IS NULL OR
                                                 confounder_coverage_pct BETWEEN 0 AND 100
                                              ),
    baseline_energy_wh_per_m  double precision CHECK (
                                                 baseline_energy_wh_per_m IS NULL OR
                                                 baseline_energy_wh_per_m >= 0
                                              ),
    treatment_energy_wh_per_m double precision CHECK (
                                                 treatment_energy_wh_per_m IS NULL OR
                                                 treatment_energy_wh_per_m >= 0
                                              ),
    effect_energy_wh_per_m    double precision,
    baseline_success_pct      double precision CHECK (
                                                 baseline_success_pct IS NULL OR
                                                 baseline_success_pct BETWEEN 0 AND 100
                                              ),
    treatment_success_pct     double precision CHECK (
                                                 treatment_success_pct IS NULL OR
                                                 treatment_success_pct BETWEEN 0 AND 100
                                              ),
    effect_success_pct        double precision,
    baseline_speed_mps        double precision CHECK (
                                                 baseline_speed_mps IS NULL OR
                                                 baseline_speed_mps >= 0
                                              ),
    treatment_speed_mps       double precision CHECK (
                                                 treatment_speed_mps IS NULL OR
                                                 treatment_speed_mps >= 0
                                              ),
    effect_speed_mps          double precision,
    estimated_at              timestamptz      NOT NULL
);

CREATE INDEX IF NOT EXISTS advanced_federated_cards_subject_vehicle_idx
    ON advanced_federated_model_cards (subject, vehicle_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS advanced_federated_rounds_card_started_idx
    ON advanced_federated_rounds (model_card_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS advanced_causal_experiments_subject_vehicle_idx
    ON advanced_causal_experiments (subject, vehicle_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS advanced_causal_experiments_metric_idx
    ON advanced_causal_experiments (vehicle_id, metric, treatment_end DESC);

COMMENT ON TABLE advanced_federated_model_cards IS
    'Subject-scoped local model cards. Stores the isolation subject, privacy accounting, and aggregate metrics only; never trips, locations, video, VINs, or contributor identities.';
COMMENT ON TABLE advanced_federated_rounds IS
    'Aggregate metadata for confirmed local training rounds. No raw training examples or gradients are persisted.';
COMMENT ON COLUMN advanced_federated_rounds.local_metric_wh_per_m IS
    'Aggregate local efficiency metric in Watt-hours per meter; NULL when source evidence is insufficient.';
COMMENT ON TABLE advanced_causal_experiments IS
    'Subject-scoped, confirmation-gated intervention windows and transparent analysis state.';
COMMENT ON TABLE advanced_causal_results IS
    'Typed experiment estimates. Only the columns matching the experiment metric are populated; unsupported estimates remain NULL.';

COMMIT;
