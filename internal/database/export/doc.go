// Package export holds the data-export aggregate repositories.
//
// Layer: adapter
//
// Files split by bounded context per ADR-011:
//
//   - repo.go               (was internal/database/export_repo.go)
//     Account-table snapshot read API (ExportTableSnapshot,
//     FetchTableSnapshot, AllowedAccountTables, CountTableRows).
//   - job_repo.go           (was internal/database/export_job_repo.go)
//     ExportJob CRUD + lifecycle (Create / UpdateStatus / Complete /
//     Fail / GetByID / GetFileData / List / CleanupOld).
//   - job_repo_bulk.go      (was internal/database/export_job_repo_bulk.go)
//     Bulk ID-set helpers (BulkDeleteByIDs, FilterExistingStringIDs)
//     for the exports-bulk admin endpoints.
//   - scheduled_repo.go     (was internal/database/scheduled_export_repo.go)
//     Scheduled-export CRUD + cron validation + delivery routing +
//     range-window canonicalization. Owns ErrScheduledExport* sentinels.
//
// Aggregate roots: ExportJob and ScheduledExport. The account snapshot
// helpers are read-only views over upstream tables and are grouped here
// because the only producer is the export feature.
//
// Cross-package wiring: callers import this subpkg as `exportdb` per the
// ADR-011 alias convention (mandatory at callsites that ALSO import the
// runtime `internal/export` package such as cmd/export-worker and
// internal/export/*).
//
//	import (
//	    exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
//	)
package export
