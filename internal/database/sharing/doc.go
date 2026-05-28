// Package sharing holds persistence for share-link tokens (drive/trip
// public share URLs).
//
// Layer: adapter
//
// Carved from the parent `internal/database` package as part of Phase R4
// (bounded-context restructure per ADR-011 §3 + ADR-015-amend).
//
// The aggregate root is [TokenRepo] managing share-link tokens.
// Future R4 batches may add view-count or saved-views repos here.
package sharing
