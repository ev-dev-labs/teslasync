-- Phase-46 / Prompt 57 — rollback for auth_subjects.
--
-- Drop the index explicitly even though DROP TABLE … CASCADE removes
-- it implicitly: keeps the rollback symmetric with the up migration
-- and surfaces stray references during a partial migration run.

DROP INDEX IF EXISTS idx_auth_subjects_last_seen;
DROP TABLE IF EXISTS auth_subjects;
