-- Phase-46 / Prompt 27 rollback: drop the grouping column + index added
-- by 000172.up.sql. Existing rows lose their group_key value; older
-- code that doesn't know about grouping continues to work because the
-- flat read paths never referenced the column.

BEGIN;

DROP INDEX IF EXISTS idx_notification_logs_group_key;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS group_key;

COMMIT;
