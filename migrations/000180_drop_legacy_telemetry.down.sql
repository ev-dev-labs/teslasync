-- Phase-42 migration 000180 (DOWN): intentional no-op rollback.
--
-- The up migration drops 38 legacy telemetry tables in one CASCADE. Several
-- names are reclaimed under new SI-canonical schemas in migrations
-- 000181-000188 (positions, drives, charging_sessions, trips, trip_drives,
-- *_snapshots, fsm_transitions, vehicle_live_state). The remaining 17 tables
-- are deleted with no replacement (see ADR-004 #4: forward-only, no backfill).
--
-- Re-running this down migration will NOT restore the legacy schemas. We
-- raise loudly so an operator who runs `migrate down` by mistake gets a wall,
-- not silence. To recover the pre-phase-42 state, restore from the
-- `phase-42-pre-drop` backup taken before this migration was applied (see
-- runbook in prompt 0090).
DO $$
BEGIN
  RAISE EXCEPTION
    'phase-42 migration 000180 has no rollback by design (ADR-004 #4). '
    'Restore from a pre-phase-42 backup if you need the legacy schema.';
END
$$;
