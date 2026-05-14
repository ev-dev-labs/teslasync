-- Phase-2 / Status API — operator-managed incident lifecycle.
--
-- Backs the /api/v1/status/incidents endpoints and the System Status
-- page's "Active incidents" + post-mortem timeline. Intentionally
-- minimal: this is a self-hosted operator's *personal* incident log,
-- not a public statuspage product. No teams, no organisations, no
-- subscribers — those concerns are out-of-scope per the Phase 2 spec.
--
-- Lifecycle: investigating → identified → monitoring → resolved
-- Severity:  minor | major | critical
-- Source:    manual | auto (auto rows are created by the health monitor
--            when a component flips to unhealthy and torn down on flip
--            back to healthy unless the operator has annotated them).
--
-- The updates JSONB column carries the timeline as an append-only array
-- of {at, status, message, author?} objects. We keep timeline updates
-- in the row (rather than a child table) because:
--   * a single incident has a small, bounded number of updates,
--   * the only access pattern is "render the whole timeline",
--   * a child table would force a join on every list response.
BEGIN;

CREATE TABLE IF NOT EXISTS status_incidents (
  id                  bigserial   PRIMARY KEY,
  title               text        NOT NULL,
  description         text        NOT NULL DEFAULT '',
  severity            text        NOT NULL DEFAULT 'minor'
                                  CHECK (severity IN ('minor', 'major', 'critical')),
  status              text        NOT NULL DEFAULT 'investigating'
                                  CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  source              text        NOT NULL DEFAULT 'manual'
                                  CHECK (source IN ('manual', 'auto')),
  affected_components text[]      NOT NULL DEFAULT '{}',
  updates             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  started_at          timestamptz NOT NULL DEFAULT NOW(),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  created_by          text,
  auto_dedupe_key     text UNIQUE
);

COMMENT ON TABLE status_incidents IS
  'Operator-managed incident log surfaced on /system-status (Phase 2 / Status API).';
COMMENT ON COLUMN status_incidents.severity IS
  'minor (one component degraded) | major (user-impacting) | critical (outage).';
COMMENT ON COLUMN status_incidents.status IS
  'investigating → identified → monitoring → resolved.';
COMMENT ON COLUMN status_incidents.source IS
  'manual (operator-logged) | auto (auto-detected by health monitor).';
COMMENT ON COLUMN status_incidents.affected_components IS
  'Subset of resilience.HealthMonitor component names this incident touches.';
COMMENT ON COLUMN status_incidents.updates IS
  'Append-only JSON array of timeline events [{at, status, message, author?}].';
COMMENT ON COLUMN status_incidents.auto_dedupe_key IS
  'Used by auto-detection to recognise the same incident across health-monitor ticks; NULL for manual entries.';

CREATE INDEX IF NOT EXISTS idx_status_incidents_active
  ON status_incidents (started_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_status_incidents_resolved
  ON status_incidents (resolved_at DESC) WHERE resolved_at IS NOT NULL;

COMMIT;
