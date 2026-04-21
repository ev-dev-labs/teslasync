-- pgvector — enables semantic similarity search for the AI chatbot
-- and other AI-powered features. The extension must be available in the
-- Postgres image (see docker-compose.yml uses pgvector/pgvector:pg17).
--
-- On managed services (RDS, Azure Flexible Server, Supabase, Cloud SQL)
-- pgvector is typically pre-installed and just needs CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table — one row per (entity_type, entity_id) pair.
-- Content is the human-readable summary that was embedded; metadata is
-- a JSONB bag for cheap pre-filters alongside the vector search.
CREATE TABLE IF NOT EXISTS embeddings (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     TEXT        NOT NULL,                     -- 'drive' | 'charge' | 'alert' | 'daily_summary' | 'software_update'
    entity_id       BIGINT      NOT NULL,
    vehicle_id      BIGINT      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    content         TEXT        NOT NULL,
    embedding       vector(1536),                             -- OpenAI text-embedding-3-small dimension
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    model           TEXT        NOT NULL DEFAULT 'text-embedding-3-small',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT embeddings_entity_unique UNIQUE (entity_type, entity_id)
);

-- HNSW index for fast approximate nearest neighbour on cosine distance.
-- ef_construction/m tuned for a small-to-medium dataset (under ~100k rows).
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
    ON embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Composite indexes for filtered searches (by vehicle / entity type).
CREATE INDEX IF NOT EXISTS idx_embeddings_entity_vehicle
    ON embeddings (entity_type, vehicle_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_vehicle_created
    ON embeddings (vehicle_id, created_at DESC);

COMMENT ON TABLE embeddings IS
    'Vector embeddings of vehicle data (drives, charges, alerts, summaries) used by the AI chatbot for semantic retrieval.';
COMMENT ON COLUMN embeddings.embedding IS
    'pgvector embedding (cosine distance). Nullable so we can insert pending rows before the async worker computes the vector.';
