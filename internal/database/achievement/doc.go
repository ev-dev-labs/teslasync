// Package achievement persists first-unlock timestamps for lifetime achievements.
//
// Layer: adapter
//
// Exports a single aggregate root [Unlock] + its repository [UnlockRepo].
//
// Split from the parent `internal/database` package as a bounded context per
// ADR-011 section 3 and ADR-015-amend; see docs/architecture/migration/cluster-map.md.
//
// The repo accepts a *database.DB from the parent (not a local interface) so
// callers can keep using the existing pool wiring without an additional
// adapter layer.
package achievement
