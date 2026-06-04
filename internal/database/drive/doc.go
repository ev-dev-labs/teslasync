// Package drive holds the Drive aggregate-root repositories: drive
// session persistence, diagnostic snapshots, lifetime mileage rollups,
// and parked-period vampire-drain measurements.
//
// Layer: adapter
//
// Files split by bounded context per ADR-011:
//
//   - repo.go               (was internal/database/drive_repo.go)
//     Drive session persistence with partial-update support; calls
//     database.BuildPartialUpdate for the SET-clause builder.
//   - diagnostic_repo.go    (was internal/database/drive_diagnostic_repo.go)
//     Read-side drive-diagnostic snapshots backing
//     /api/v1/drives/{id}/diagnostic.
//   - mileage_repo.go       (was internal/database/mileage_repo.go)
//     Daily/monthly mileage rollups derived from drive sessions.
//   - vampire_drain_repo.go (was internal/database/vampire_drain_repo.go)
//     Energy-drain events measured between consecutive drives (parked).
//
// Aggregate root: Drive (with diagnostic, mileage, and vampire-drain as
// read-side projections that depend on the drive timeline).
//
// Cross-package wiring: callers import this subpkg as `drivedb` per the
// ADR-011 alias convention (e.g.
// `drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"`).
//
// DrivePartialAllowed is exported so partial_allowed_test.go can verify
// the allow-list externally.
package drive
