// Package gen builds the TeslaSync OpenAPI 3.1 contract directly from the Chi
// router, which is the single source of truth for the HTTP surface (ADR-003).
//
// The router is constructed with inert stub dependencies (a non-connecting
// pgx pool, a no-op signal.StateReader, an empty config) purely so that route
// registration runs; no handler is ever invoked during generation. chi.Walk
// then enumerates every registered (method, path) pair, and BuildSpec turns
// that into an OpenAPI 3.1 document. Because the spec is generated FROM the
// walked routes, route coverage is guaranteed by construction.
//
// This package is intentionally importable (not package main) so the
// conformance test in internal/api can build the exact same router and assert
// the committed spec still matches it.
//
// Layer: tooling
package gen
