// Package backup holds repository types for the database-backup aggregate:
// BackupConfigRepo manages user-configured backup schedules; BackupRunRepo
// tracks per-execution rows (status, started_at, completed_at, error,
// artifact metadata) consumed by the export-worker scheduler.
//
// Carved from internal/database in Phase R4.5 per ADR-011. Callers import
// as `dbbackup` to disambiguate from the runtime internal/backup package.
//
// Layer: adapter
package backup
