CREATE TABLE IF NOT EXISTS tesla_user_profiles (
    id                BIGSERIAL PRIMARY KEY,
    email             TEXT NOT NULL DEFAULT '',
    full_name         TEXT NOT NULL DEFAULT '',
    profile_image_url TEXT,
    raw_json          JSONB NOT NULL DEFAULT '{}',
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
