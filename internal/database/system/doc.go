// Package system holds system-wide admin/observability repositories.
//
// Layer: adapter
//
// Carved files (Phase R4.19 — bounded-context restructure per ADR-011):
//
//   - software_update_repo.go (was internal/database/software_update_repo.go)
//     Per-vehicle Tesla software-update history with idempotent
//     insert-if-changed semantics.
//   - state_repo.go           (was internal/database/system_state_repo.go)
//     System-wide mode (ok / degraded / maintenance) + maintenance
//     banner message. Owns SystemMode* consts + ErrInvalidSystemMode +
//     ValidateSystemMode / NormalizeMaintenanceMessage helpers.
//   - api_call_log_repo.go    (was internal/database/api_call_log_repo.go)
//     Append-only API audit log (per-request method/path/status/duration).
//   - guard_repo.go           (was internal/database/guard_repo.go)
//     Vehicle Sentry/Guard-mode event store (sentry_clip events,
//     security-related telemetry triggers). Owns ErrGuardEventNotFound.
//
// Intentionally NOT carved (kept in parent internal/database):
//
//   - maintenance.go          — methods receive *DB (CleanupOldPositions /
//     CleanupOldStates / VacuumAnalyze / GetPositionStats); moving them
//     would require either method-relocation or a parent re-import.
//     Treated as DB infrastructure.
//   - query_budget_tracer.go  — wired into DB constructor via
//     newCompositeTracer(); parent database.go consumes it directly.
//     Treated as DB infrastructure.
//
// Cross-package wiring: callers import this subpkg as `systemdb` per
// the ADR-011 alias convention.
//
//	import (
//	    systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
//	)
package system
