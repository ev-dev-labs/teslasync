-- Durable "is this install configured" marker, decoupled from runtime
-- telemetry/token health. Before this migration, GET /onboarding/status
-- computed is_complete = tesla_connected && vehicle_count>0 && data_flowing
-- on every request, so a Fleet Telemetry outage or an expired Tesla token
-- would flip an already-configured installation back into "first-run" in
-- the frontend gate. See internal/api/onboarding/handler.go and
-- internal/database/user/onboarding_state_repo.go for the read/write side.
--
-- Single row (id=1), mirroring the system_state pattern introduced by
-- migration 000168.
BEGIN;

CREATE TABLE IF NOT EXISTS onboarding_state (
  id                  integer     PRIMARY KEY CHECK (id = 1),
  setup_completed     boolean     NOT NULL DEFAULT false,
  setup_completed_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE onboarding_state IS
  'Durable first-run setup completion marker (single row, id=1). Once '
  'setup_completed flips true the application NEVER resets it back to '
  'false based on runtime signals (telemetry staleness, token expiry) '
  '— see GET /api/v1/onboarding/status.';
COMMENT ON COLUMN onboarding_state.setup_completed IS
  'True once tesla_connected && vehicle_count>0 && data_flowing were '
  'observed true at least once (or backfilled below for a pre-existing '
  'install). A ratchet: the application never writes false here.';
COMMENT ON COLUMN onboarding_state.setup_completed_at IS
  'Timestamp of the first observed completion. NULL until completed.';

-- Backfill for pre-existing installations. An install that already has
-- at least one vehicle AND a stored Tesla token is durably "configured"
-- even if this migration happens to run while Fleet Telemetry is
-- disconnected (data_flowing=false at migration time), or for
-- installations that never enable Fleet Telemetry at all (REST-polling
-- only, where signal_log — and therefore data_flowing — is never
-- populated). Requiring data_flowing in this backfill would incorrectly
-- re-trap already-working installations into the first-run gate on the
-- very upgrade that ships this fix, which is exactly the regression
-- this migration exists to prevent. Fresh installs after this migration
-- still go through the full three-anchor live check the first time
-- (see the handler) — this backfill only covers installs that already
-- exist right now.
INSERT INTO onboarding_state (id, setup_completed, setup_completed_at)
SELECT 1, true, NOW()
WHERE EXISTS (SELECT 1 FROM vehicles)
  AND EXISTS (
    SELECT 1 FROM tokens
     WHERE id = 1 AND access_token IS NOT NULL AND access_token <> ''
  )
ON CONFLICT (id) DO NOTHING;

-- Every other install (genuinely fresh, or partially configured) gets
-- the not-yet-completed default row so the repo can always assume the
-- row exists — no NULL-row special-casing on the read path.
INSERT INTO onboarding_state (id, setup_completed)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
