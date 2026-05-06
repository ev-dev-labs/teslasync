-- Phase-46 / Prompt 04: persist operator-controlled service mode so a
-- maintenance/degraded banner can be set at runtime via the admin UI
-- (POST /api/v1/admin/maintenance) and survive API restarts.
--
-- The table is intentionally a single row with a CHECK (id = 1) guard
-- so callers can read/write without worrying about which row to touch.
-- The seed INSERT...ON CONFLICT DO NOTHING keeps the migration
-- idempotent; subsequent re-runs (or down/up cycles in dev) leave any
-- operator-set state untouched if the row already exists.
BEGIN;

CREATE TABLE IF NOT EXISTS system_state (
  id                  integer       PRIMARY KEY CHECK (id = 1),
  mode                text          NOT NULL DEFAULT 'ok',
  maintenance_message text,
  maintenance_until   timestamptz,
  updated_at          timestamptz   NOT NULL DEFAULT NOW(),
  updated_by          text
);

COMMENT ON TABLE system_state IS
  'Operator-controlled service mode banner state. Single row (id=1).';
COMMENT ON COLUMN system_state.mode IS
  'One of: ok | degraded | maintenance. Drives top-of-app banner.';
COMMENT ON COLUMN system_state.maintenance_message IS
  'Operator-supplied banner text (max 280 chars enforced at write time).';
COMMENT ON COLUMN system_state.maintenance_until IS
  'When the banner should auto-clear (informational; SPA renders countdown).';
COMMENT ON COLUMN system_state.updated_by IS
  'ForwardAuth header value of the actor who last wrote this row.';

INSERT INTO system_state (id, mode) VALUES (1, 'ok')
  ON CONFLICT (id) DO NOTHING;

COMMIT;
