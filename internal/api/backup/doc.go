// Package backup is the HTTP-facing handler subpackage for backup and
// restore endpoints.
//
// Layer: handler
//
// # Why this subpackage exists
//
// This is the first resource handler carve under Phase R2 (waves
// R2a–R2e). R2.0a–R2.0e established the shared infrastructure
// subpackages (httpx, apiparams, apitest, middleware, apperror) — the
// substrate every resource subpkg shares. R2a moves the backup
// handlers out of the flat internal/api parent into a self-contained
// subpkg, exercising the full carve pattern (handler types, route
// mounts, AppError catalog usage) on a moderately-sized surface (~14 KB
// across 2 files; one of the heaviest writeAppError consumers).
//
// # Exported surface
//
//   - Handler          — admin-style data-export endpoints (ExportData,
//     BackupStats). Mounted under /api/v1/system/*.
//   - RestoreHandler   — config CRUD + run management + download/
//     verify/preview-restore endpoints. Mounted
//     under /api/v1/backup/*.
//   - NewHandler(db)        — constructs *Handler.
//   - NewRestoreHandler(db) — constructs *RestoreHandler (wires
//     dbbackup.BackupConfigRepo +
//     dbbackup.BackupRunRepo +
//     corebackup.Processor).
//   - AllowedTables    — read-only whitelist of tables safe to dump via
//     ExportData / BackupStats. Exported so the
//     AllowedTables regression test in this package
//     and any future admin tooling can reference the
//     canonical list.
//
// # Package-name collision
//
// The platform-side backup logic (Processor, Provider, NewProvider)
// lives in internal/backup, which is also package name `backup`. This
// subpackage takes precedence in its own files, so the platform pkg is
// imported with the alias `corebackup` here. Routers and other
// consumers of this subpkg should import as
// `apibackup "github.com/ev-dev-labs/teslasync/internal/api/backup"`.
//
// # Wire contract
//
// All handlers emit responses via apperror.Write (errors) and
// httpx.WriteJSON (successes), preserving the FLAT envelope shape
// {error, code, category} that the SPA's resilience layer
// (web/src/lib/resilience.ts) matches on. The route mount layout is
// owned by internal/api/router.go and unchanged by R2a.
package backup
