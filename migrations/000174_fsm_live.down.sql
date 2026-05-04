-- Phase-42 / Prompt 0035 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling back
-- this migration leaves no fsm_transitions or vehicle_live_state table;
-- any consumer that requires either must re-apply the up.sql.
--
-- CASCADE removes any view or FK that may have been attached to either
-- table after this migration applied (none exist at this slot, but the
-- CASCADE keeps the rollback resilient if a later prompt adds dependents).
DROP TABLE IF EXISTS fsm_transitions    CASCADE;
DROP TABLE IF EXISTS vehicle_live_state CASCADE;
