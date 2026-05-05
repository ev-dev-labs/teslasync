-- Phase-46 / Prompt 08 rollback: drop the in-app feedback table. All
-- captured reports are lost — operators should export the queue before
-- downgrading.
BEGIN;

DROP INDEX IF EXISTS idx_user_feedback_submitter_created;
DROP INDEX IF EXISTS idx_user_feedback_status_created;
DROP TABLE IF EXISTS user_feedback;

COMMIT;
