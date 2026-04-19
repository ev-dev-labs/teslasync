CREATE TABLE IF NOT EXISTS tesla_user_config (
    id              BIGSERIAL PRIMARY KEY,
    config_type     TEXT NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(config_type)
);
