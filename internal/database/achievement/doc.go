// Package achievement holds the persistence layer for first-unlock timestamps
// of lifetime achievements (Phase-40 prompt 63).
//
// Layer: adapter
//
// Exports a single aggregate root [Unlock] + its repository [UnlockRepo].
//
// Carved from the parent `internal/database` package as part of Phase R4
// (bounded-context restructure per ADR-011 §3 + ADR-015-amend) — see
// docs/architecture/migration/cluster-map.md and plan.md §16.5.
//
// The repo accepts a *database.DB from the parent (not a local interface) so
// callers can keep using the existing pool wiring without an additional
// adapter layer. A future R4.5 may extract shared/ infrastructure if needed.
package achievement
