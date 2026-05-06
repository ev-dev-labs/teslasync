-- Phase-42 / Prompt 0034 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling back
-- this migration leaves no signal_log table; any consumer that requires
-- it must re-apply the up.sql.
--
-- CASCADE removes any continuous aggregate or view that may have been
-- attached to signal_log after this migration applied (none exist at
-- this slot, but the CASCADE keeps the rollback resilient if a later
-- prompt adds CAGGs over the new schema).
DROP TABLE IF EXISTS signal_log CASCADE;
