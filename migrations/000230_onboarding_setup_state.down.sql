-- Rollback for 000230_onboarding_setup_state: drop the durable setup
-- completion marker. Any persisted completion state is lost — after
-- downgrading, the frontend gate reverts to the pre-migration
-- behavior (is_complete recomputed live on every request from
-- tesla_connected/vehicle_count/data_flowing only).
BEGIN;

DROP TABLE IF EXISTS onboarding_state;

COMMIT;
