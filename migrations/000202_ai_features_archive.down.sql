-- Phase-50 / 0003 — F2 Settings UI for AI (rollback).
--
-- Removes the ai_features_archived row inserted by 000202_*.up.sql.
-- Order is trivial (single row delete), no constraint changes.

BEGIN;

DELETE FROM settings WHERE key = 'ai_features_archived';

COMMIT;
