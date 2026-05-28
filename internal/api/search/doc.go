// Package search hosts the global cross-resource search endpoint
// (GET /api/v1/search) backing the SPA's omnibar and the AI hydrator
// fan-out for natural-language search and drive-replay tools.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2d.1 — first non-vehicle resource cluster carved
// out of the flat internal/api parent. Same precedent as the R2c.*
// family: depends only on shared infrastructure (httpx) plus the
// external internal/database core. MUST NOT import its parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler (Search) plus its WithSearcher test constructor.
//   - Searcher interface (9 per-corpus Search* methods).
//   - SearchHit envelope returned to the SPA — fields renamed
//     verbatim for SPA + AI-hydrator parity.
//   - PGSearcher concrete Postgres-backed implementation plus
//     NewPGSearcher constructor (exported because the AI hydrators
//     in the parent api package re-use this exact backend for their
//     N3 / D1 hydrator wiring; ADR-015 §I3 baseline-intact: one
//     SQL fan-out shared between the typed search baseline and the
//     AI citation hydrators).
//   - Ranking helpers (rankAndCap, scoreText, recencyBonus) and
//     query parsing helpers (parseTypesFilter, parseSearchLimit).
//
// # Independence
//
// Constructor NewHandler(*database.DB) wires the production
// PGSearcher; NewHandlerWithSearcher(Searcher) is the test seam.
// Test fixtures (fakeSearcher) are local to handler_test.go and
// exercise the handler against an in-memory Searcher with no pgx
// dependency.
//
// # Cross-package consumers
//
// Two parent-package hydrators (ai_search_hydrator.go and
// ai_drive_search_hydrator.go) and their tests construct
// apisearch.NewPGSearcher and accept apisearch.Searcher /
// apisearch.SearchHit by reference. Direction is one-way: ai_*
// -> search only.
package search
