CREATE TABLE IF NOT EXISTS tesla_public_key (
    id INTEGER PRIMARY KEY DEFAULT 1,
    public_key_pem TEXT NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);
