-- Export jobs table for async export processing
CREATE TABLE IF NOT EXISTS export_jobs (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,       -- drives, charging, backup
    format          TEXT NOT NULL DEFAULT 'csv',  -- csv, json
    status          TEXT NOT NULL DEFAULT 'queued', -- queued, processing, ready, failed
    vehicle_id      BIGINT,              -- optional: filter to specific vehicle
    start_date      TIMESTAMPTZ,         -- optional: date range start
    end_date        TIMESTAMPTZ,         -- optional: date range end
    file_name       TEXT,                -- generated filename
    file_data       BYTEA,               -- export result data
    file_size       BIGINT DEFAULT 0,    -- file size in bytes
    record_count    INT DEFAULT 0,       -- number of records exported
    error_message   TEXT,                -- error details if failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ          -- when processing finished
);

CREATE INDEX idx_export_jobs_status ON export_jobs (status);
CREATE INDEX idx_export_jobs_created_at ON export_jobs (created_at DESC);
