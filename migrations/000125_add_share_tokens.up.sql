CREATE TABLE share_tokens (
    id BIGSERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    drive_id BIGINT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    created_by TEXT,
    title TEXT,
    description TEXT,
    include_map BOOLEAN DEFAULT TRUE,
    include_telemetry BOOLEAN DEFAULT FALSE,
    include_speed BOOLEAN DEFAULT TRUE,
    views INT DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_share_tokens_token ON share_tokens(token);
CREATE INDEX idx_share_tokens_drive ON share_tokens(drive_id);
