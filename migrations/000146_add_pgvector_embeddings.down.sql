DROP TABLE IF EXISTS embeddings CASCADE;
-- Extension is intentionally NOT dropped — other parts of the schema (baseline)
-- may reference the `vector` type. Drop the extension explicitly out-of-band
-- when removing all vector features.
