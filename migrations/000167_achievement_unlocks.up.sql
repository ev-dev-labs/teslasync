-- Phase-40 / Prompt 63: persist achievement unlocks so a transition
-- (locked → unlocked) can be detected and surfaced as a celebration moment.
--
-- The legacy lifetime handler computes achievements purely on-the-fly from
-- aggregate totals each time the page loads, so `unlocked_at` is always nil
-- and there is no way to fire a "you just unlocked X" notification. This
-- migration adds a tiny tracking table that the handler upserts into the
-- first time `current >= target`. The PRIMARY KEY is the natural key
-- (achievement_id, vehicle_id) — vehicle_id = 0 represents the fleet-wide
-- (no vehicle filter) bucket so SQL UNIQUE handles both cases without
-- requiring `IS NOT DISTINCT FROM` semantics.
BEGIN;

CREATE TABLE IF NOT EXISTS achievement_unlocks (
  achievement_id text         NOT NULL,
  vehicle_id     bigint       NOT NULL DEFAULT 0,
  unlocked_at    timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (achievement_id, vehicle_id)
);

COMMENT ON TABLE achievement_unlocks IS
  'First-unlock timestamps for lifetime achievements. vehicle_id = 0 = fleet-wide.';
COMMENT ON COLUMN achievement_unlocks.vehicle_id IS
  'Owning vehicle, or 0 for the fleet-wide (no vehicle filter) bucket.';
COMMENT ON COLUMN achievement_unlocks.unlocked_at IS
  'Wall-clock time (UTC) when the achievement first crossed its target. '
  'Drives the dashboard "recently unlocked" strip and the celebration toast.';

CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unlocked_at
  ON achievement_unlocks (unlocked_at DESC);

COMMIT;
