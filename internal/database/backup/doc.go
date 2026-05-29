// Package backup holds repository types for the database-backup aggregate:
// BackupConfigRepo manages user-configured backup schedules; BackupRunRepo
// tracks per-execution rows (status, started_at, completed_at, error,
// artifact metadata) consumed by the export-worker scheduler.
//
// Callers import this package as `dbbackup` to disambiguate it from
// the runtime internal/backup package.
//
// Layer: adapter
package backup
