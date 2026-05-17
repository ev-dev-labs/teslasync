-- Phase-50 / 0009 — F8 Redaction Layer columns.
--
-- Adds two columns to ai_call_log so the audit row records what
-- happened during F8 redaction:
--
--   redacted_classes  TEXT[]  — distinct PIIClass values that were
--                                rewritten on this call (e.g. {vin,
--                                email}). Empty array when nothing
--                                was redacted (a clean prompt).
--   redaction_bypass  BOOLEAN — true when the redact decorator skipped
--                                redaction entirely (local-loopback
--                                provider, or no policy installed in
--                                ctx — defence in depth). Used by the
--                                bypass report (admin endpoint) to
--                                flag features whose >0% of calls
--                                bypass unexpectedly.
--
-- ADR-015 invariants
-- ------------------
--   §I4  Zero outbound egress  — the redact decorator is the LAST
--                                cross-cut before the wire. These
--                                columns expose its activity in the
--                                audit row so an operator can verify
--                                the deny-by-default stance held.
--   §I9  Privacy + redaction   — the columns record outcomes ONLY,
--                                never the PII itself. The class
--                                names ('vin','email',...) are
--                                category labels; no values leave
--                                the redact in-process Manifest.
--   §I12 Auditable             — every cloud call's class set is
--                                queryable for compliance review.
--
-- Slot variance
-- -------------
-- Prompt 0009 hardcodes 000202, but slot 000202 is taken by
-- ai_features_archive (Phase-50 / F2). The next free post-AI-pipeline
-- slot after 000206_embeddings (F7) is 000207. Documenting in the
-- header per the F3 precedent.
--
-- Reversible by the matching .down.sql (drops both columns).

BEGIN;

ALTER TABLE ai_call_log
    ADD COLUMN IF NOT EXISTS redacted_classes TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS redaction_bypass BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_call_log.redacted_classes IS
    'Distinct PIIClass labels rewritten on this call (e.g. {vin,email}). '
    'Source of truth: internal/ai/redact/class.go. Empty array when '
    'nothing was redacted. Class labels only — never PII values.';
COMMENT ON COLUMN ai_call_log.redaction_bypass IS
    'TRUE when the F8 redact decorator skipped redaction (local-loopback '
    'provider, or no policy in ctx — defence in depth). The admin bypass '
    'report flags any feature whose >0% of calls bypass unexpectedly.';

-- Per-feature bypass report query (admin endpoint) groups by
-- (feature_id, redaction_bypass) and bins by started_at. The existing
-- ai_call_log_feature_started_idx already covers this access pattern;
-- no additional index is required.

COMMIT;
