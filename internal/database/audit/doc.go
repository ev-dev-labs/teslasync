// Package audit holds the audit-trail and operational-audit repositories
// for TeslaSync's append-only history surfaces.
//
// Layer: adapter
//
// Bounded-context files per ADR-011:
//
//   - repo.go                          (was internal/database/audit_repo.go)
//     Reveal + impersonation audit-event writers backing /api/v1/admin/audit-* endpoints.
//   - log_query_repo.go                (was internal/database/audit_log_query_repo.go)
//     Read-side query repo over the full audit_logs table.
//   - dlq_replay_repo.go               (was internal/database/dlq_replay_audit_repo.go)
//     Replay-attempt audit ledger for the MQTT DLQ tooling.
//   - feature_flag_changes_repo.go     (was internal/database/feature_flag_changes_repo.go)
//     Audit ledger for runtime feature-flag mutations (internal/flags).
//
// Aggregate root: AuditLog (read-only view + four append-only writers).
//
// Cross-package wiring: callers import this subpkg as `auditdb` per the
// ADR-011 alias convention (e.g.
// `auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"`).
//
// The exported helper `database.NullIfEmpty` lives in the parent
// package (`internal/database/null_helpers.go`) because the auth
// subpackage already depends on it; the audit carve preserves that
// boundary by importing the parent for the helper (see audit/repo.go).
package audit
