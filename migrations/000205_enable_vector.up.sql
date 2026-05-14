-- Phase-50 / 0008 — F7 Embeddings + pgvector RAG.
--
-- Enables the pgvector extension and asserts a minimum version that
-- supports HNSW indexes (added upstream in pgvector 0.5.0). The
-- TimescaleDB-HA Docker image (pinned by docker-compose.yml) bundles
-- pgvector ≥ 0.7 today, so this migration is effectively a no-op on
-- production deployments — but the version assertion guarantees a
-- self-hosted operator who pulls a stripped Postgres image is forced
-- to upgrade rather than silently fall back to the slower IVFFlat
-- recall path that 000206 cannot use.
--
-- Slot variance vs the prompt
-- ---------------------------
-- The prompt (Phase-50 / 0008) hardcodes `000200_enable_vector`, but
-- slot 000200 is occupied by alert_rule_message_template (Phase-49)
-- and slots 000201..000204 are occupied by F0..F5 of the AI adoption
-- ladder. The next free slot after F5 (000204) is 000205, used here.
-- F0 (000201) and F3 (000203) set the precedent for slot-variance
-- documentation in this phase.
--
-- ADR-015 invariants touched
-- --------------------------
--   §I1  Default-off          — enabling the extension is harmless;
--                               no rows are written until F7's tables
--                               (000206) are populated by an opted-in
--                               feature.
--   §I4  Zero outbound egress — pgvector itself is a local C library;
--                               enabling it makes no network call.
--
-- Reversible by the matching .down.sql.

BEGIN;

-- 1. Enable the extension. CREATE EXTENSION IF NOT EXISTS is idempotent
--    so a re-run on a database that already has pgvector is a no-op.
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Assert the version satisfies our minimum (≥ 0.5.0).
--
--    Naive text comparison fails for two-digit minor/patch numbers:
--    `'0.10.0' >= '0.5.0'` is FALSE because '0.1' < '0.5' in lex
--    order. Cast to int[] and compare element-wise so the check
--    behaves correctly for any future minor/patch combination
--    pgvector ships.
DO $check$
DECLARE
    v_text TEXT;
    v_parts INT[];
BEGIN
    SELECT extversion INTO v_text
    FROM pg_extension
    WHERE extname = 'vector';

    IF v_text IS NULL THEN
        RAISE EXCEPTION
            'phase-50 F7: pgvector extension is not registered in pg_extension after CREATE; aborting';
    END IF;

    -- string_to_array yields TEXT[]; explicit cast to INT[] coerces
    -- each element. A non-numeric component (e.g. a pre-release
    -- suffix) raises invalid_text_representation, which we want — a
    -- non-standard build is a deploy-time failure, not a runtime
    -- mystery.
    v_parts := string_to_array(v_text, '.')::INT[];

    -- Pad to three components so the comparison below is well-defined
    -- whether the vendor publishes "0.7" or "0.7.0".
    WHILE array_length(v_parts, 1) < 3 LOOP
        v_parts := v_parts || ARRAY[0];
    END LOOP;

    IF v_parts[1] < 0
        OR (v_parts[1] = 0 AND v_parts[2] < 5)
        OR (v_parts[1] = 0 AND v_parts[2] = 5 AND v_parts[3] < 0)
    THEN
        RAISE EXCEPTION
            'phase-50 F7: pgvector >= 0.5.0 required for HNSW indexes; found %', v_text;
    END IF;
END
$check$;

COMMIT;
