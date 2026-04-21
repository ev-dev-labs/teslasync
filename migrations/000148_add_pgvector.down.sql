DROP INDEX IF EXISTS idx_embeddings_vehicle_created;
DROP INDEX IF EXISTS idx_embeddings_entity_vehicle;
DROP INDEX IF EXISTS idx_embeddings_vector;
DROP TABLE IF EXISTS embeddings;

-- NOTE: We intentionally do NOT `DROP EXTENSION vector` here. Other tables
-- or future migrations may rely on the extension and dropping it would
-- cascade in surprising ways. Operators can drop the extension manually
-- with `DROP EXTENSION vector` if needed.
