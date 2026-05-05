-- Phase-46 / Prompt 65 — rollback for scheduled_exports.
--
-- Drop indexes explicitly even though DROP TABLE … CASCADE removes
-- them implicitly: keeps the rollback symmetric with the up migration
-- and surfaces stray references during a partial migration run.

DROP INDEX IF EXISTS idx_scheduled_exports_owner;
DROP INDEX IF EXISTS idx_scheduled_exports_next_run;
DROP TABLE IF EXISTS scheduled_exports;
