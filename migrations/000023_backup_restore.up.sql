-- Migration 23: Backup & Restore system
-- Adds backup configuration, run history, and scheduling support.

-- Backup configurations (user-defined backup schedules)
CREATE TABLE IF NOT EXISTS backup_configs (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT 'Default Backup',
    enabled         BOOLEAN NOT NULL DEFAULT false,
    backup_type     TEXT NOT NULL DEFAULT 'full',        -- full, incremental
    frequency_days  INTEGER NOT NULL DEFAULT 1,          -- 1-30 days
    max_retention   INTEGER NOT NULL DEFAULT 30,         -- keep last N backups
    provider        TEXT NOT NULL DEFAULT 'local',       -- local, s3, azure, gcs, onedrive
    provider_config JSONB NOT NULL DEFAULT '{}',         -- provider-specific credentials/config
    include_tables  TEXT[] DEFAULT NULL,                  -- NULL = all tables
    compress        BOOLEAN NOT NULL DEFAULT true,
    encrypt         BOOLEAN NOT NULL DEFAULT false,
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backup run history (tracks every backup/restore execution)
CREATE TABLE IF NOT EXISTS backup_runs (
    id              BIGSERIAL PRIMARY KEY,
    config_id       BIGINT REFERENCES backup_configs(id) ON DELETE SET NULL,
    run_type        TEXT NOT NULL DEFAULT 'backup',      -- backup, restore
    backup_type     TEXT NOT NULL DEFAULT 'full',        -- full, incremental
    status          TEXT NOT NULL DEFAULT 'queued',      -- queued, running, completed, failed, cancelled
    provider        TEXT NOT NULL DEFAULT 'local',
    file_name       TEXT,
    file_path       TEXT,                                -- remote path/key in provider
    file_size       BIGINT DEFAULT 0,
    record_count    INTEGER DEFAULT 0,
    table_count     INTEGER DEFAULT 0,
    checksum        TEXT,                                -- SHA-256 of backup file
    duration_ms     BIGINT DEFAULT 0,
    error_message   TEXT,
    metadata        JSONB DEFAULT '{}',                  -- extra info (tables backed up, versions, etc.)
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_config_id ON backup_runs (config_id);
CREATE INDEX IF NOT EXISTS idx_backup_runs_status ON backup_runs (status);
CREATE INDEX IF NOT EXISTS idx_backup_runs_created_at ON backup_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_configs_next_run ON backup_configs (next_run_at) WHERE enabled = true;
