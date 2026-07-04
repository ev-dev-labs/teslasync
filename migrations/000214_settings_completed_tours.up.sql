-- Migration 214: Persist completed/skipped onboarding tours.
--
-- Goal: keep the intro tour from re-triggering after a browser clears
-- localStorage/cookies by persisting each user's completed-tour markers
-- server-side, exactly the way theme/mode/units already round-trip through
-- GET/PUT /api/v1/settings.
--
-- Schema adaptation vs. a wide-column `settings` row:
--   The task prompt was written assuming `settings` still had one column per
--   preference (as it did pre-000142), i.e. `ADD COLUMN completed_tours
--   TEXT[]`. ADR-011 (migration 000142) rebuilt `settings` as a typed
--   key/value store (key, value_text, value_num, value_bool, value_jsonb,
--   data_kind), and 000201 added the JSONB value column + 'jsonb' data_kind.
--   A wide TEXT[] column would be dangling — the SettingsRepo reads/writes
--   rows, never per-setting columns — so nothing would persist. To honour the
--   prompt's intent (a JSON array of strings that round-trips through the
--   settings API) while respecting the live schema, this migration seeds a
--   single JSONB key/value row, mirroring ai_features / ai_features_archived.
--
-- Storage shape (typed key/value, ADR-011):
--   key         = 'completed_tours'
--   data_kind   = 'jsonb'
--   value_jsonb = '[]'::jsonb        (default — no tours completed yet)
--
-- Each array entry is a "{tourId}:{version}" marker (e.g. "main:1"); bumping a
-- tour's version re-arms it for everyone. ON CONFLICT DO NOTHING so re-running
-- the migration never clobbers a user who has already completed tours.
--
-- Reversible by the matching .down.sql.

BEGIN;

INSERT INTO settings (key, value_jsonb, data_kind, description)
  VALUES (
    'completed_tours',
    '[]'::jsonb,
    'jsonb',
    'JSON array of "{tourId}:{version}" markers for onboarding tours the user has completed or skipped. Prevents the intro tour from re-triggering after localStorage/cookies are cleared. Replace semantics on PUT /api/v1/settings.'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
