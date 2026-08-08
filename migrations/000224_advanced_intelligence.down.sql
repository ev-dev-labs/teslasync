BEGIN;

DROP INDEX IF EXISTS advanced_causal_experiments_metric_idx;
DROP INDEX IF EXISTS advanced_causal_experiments_subject_vehicle_idx;
DROP INDEX IF EXISTS advanced_federated_rounds_card_started_idx;
DROP INDEX IF EXISTS advanced_federated_cards_subject_vehicle_idx;
DROP TABLE IF EXISTS advanced_causal_results;
DROP TABLE IF EXISTS advanced_causal_experiments;
DROP TABLE IF EXISTS advanced_federated_rounds;
DROP TABLE IF EXISTS advanced_federated_model_cards;

COMMIT;
