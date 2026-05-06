-- Phase-42 / Prompt 0030 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling back
-- this migration leaves no positions table; any consumer that requires
-- one must re-apply the up.sql.
DROP TABLE IF EXISTS positions CASCADE;
