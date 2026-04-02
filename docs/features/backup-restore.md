# Backup & Restore

TeslaSync includes a comprehensive backup and restore system with scheduled automation, multi-provider storage, and full run history tracking.

## Overview

Backups can be configured to run automatically on a schedule (daily to every 30 days) or triggered manually with one click. All backup runs are tracked in the database with status, duration, file size, and checksum information.

## Backup Types

| Type | Description |
|------|-------------|
| **Full** | Complete database export of all tables |
| **Incremental** | Only changed data since last backup (planned) |

## Storage Providers

| Provider | Status | Configuration |
|----------|--------|---------------|
| **Local** | ✅ Full | `path` — filesystem directory |
| **Amazon S3** | 🔲 Ready | `bucket`, `region`, `access_key`, `secret_key`, `endpoint` (MinIO/R2) |
| **Azure Blob** | 🔲 Ready | `account_name`, `account_key`, `container_name` |
| **Google Cloud Storage** | 🔲 Ready | `bucket`, `credentials_json` |

## Configuration

### Via UI
Navigate to **System → Backup & Restore** in the sidebar. Create a backup configuration with:
- **Name** — descriptive label
- **Enabled** — toggle to activate scheduled backups
- **Type** — Full or Incremental
- **Frequency** — Every 1-30 days
- **Retention** — Keep last 1-100 backups
- **Provider** — Select storage backend and configure credentials
- **Compression** — Enable gzip compression (recommended)

### Via API
```bash
# Create backup config
curl -X POST http://localhost:8080/api/v1/backup/configs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily S3 Backup",
    "enabled": true,
    "backup_type": "full",
    "frequency_days": 1,
    "max_retention": 30,
    "provider": "local",
    "provider_config": {"path": "/data/backups"},
    "compress": true
  }'

# Trigger manual backup
curl -X POST http://localhost:8080/api/v1/backup/configs/1/trigger

# Quick backup (no config needed)
curl -X POST http://localhost:8080/api/v1/backup/quick

# List backup runs
curl http://localhost:8080/api/v1/backup/runs
```

## Run History

Every backup execution is tracked with:
- **Status**: queued → running → completed/failed
- **File info**: name, path, size, SHA-256 checksum
- **Metrics**: record count, table count, duration
- **Error details**: error message on failure

## Architecture

```
User/Scheduler → API → BackupConfig (DB)
                         ↓
               Export Worker (60s check)
                         ↓
               Processor → Storage Provider
                         ↓
               BackupRun (DB) → UI Status
```

The export worker checks for due backup configs every 60 seconds. When a config's `next_run_at` is past, it creates a BackupRun and executes the backup asynchronously.
