-- Dedicated personal preferences: not included in global settings export/reset.
-- The primary key is also the only lookup index needed.
CREATE TABLE IF NOT EXISTS widget_design_preferences (
    subject_scope text PRIMARY KEY,
    pack_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
