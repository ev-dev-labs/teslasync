// Package trip holds the Trip aggregate-root repositories: trip
// rollups (Drive sequences with shared origin/destination), trip-detail
// projections (with per-drive summaries), and visited-location frequency
// aggregations.
//
// Layer: adapter
//
// Carved files (Phase R4.13 — bounded-context restructure per ADR-011):
//
//   - repo.go                   (was internal/database/trip_repo.go)
//     Trip rollup persistence + monthly-trip generation from Drive rows.
//   - detail_repo.go            (was internal/database/trips_detail_repo.go)
//     Trip-detail read-side projection backing /api/v1/trips/{id}.
//   - visited_location_repo.go  (was internal/database/visited_location_repo.go)
//     Visited-location frequency aggregations over geocoded drive endpoints.
//
// Aggregate root: Trip. VisitedLocation is a sibling read projection
// over the same drive-history substrate.
//
// Cross-package wiring: callers import this subpkg as `tripdb` per the
// ADR-011 alias convention (e.g.
// `tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"`).
package trip
