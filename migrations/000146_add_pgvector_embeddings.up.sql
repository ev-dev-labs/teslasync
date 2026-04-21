-- Add pgvector extension and embeddings table for semantic search over vehicle data.
-- The vector extension is created conditionally (in case the host Postgres does
-- not ship with pgvector installed); the embeddings table and HNSW index are
-- skipped gracefully when the extension is unavailable so that TeslaSync still
-- boots on plain Postgres (dev / CI).

DO $ext$ BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available, skipping: %', SQLERRM;
END $ext$;

DO $mig$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE $ddl$
            CREATE TABLE IF NOT EXISTS embeddings (
                id              BIGSERIAL PRIMARY KEY,
                entity_type     TEXT        NOT NULL,
                entity_id       BIGINT      NOT NULL,
                vehicle_id      BIGINT      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                content         TEXT        NOT NULL,
                embedding       vector(1536),
                metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT embeddings_entity_unique UNIQUE (entity_type, entity_id)
            )
        $ddl$;

        -- HNSW index for fast approximate nearest-neighbor similarity search
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings ' ||
                'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';

        -- Composite indexes for filtered / temporal queries
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings (entity_type, vehicle_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_embeddings_vehicle ON embeddings (vehicle_id, created_at DESC)';
    ELSE
        RAISE NOTICE 'vector extension is not installed; embeddings table skipped';
    END IF;
END $mig$;
