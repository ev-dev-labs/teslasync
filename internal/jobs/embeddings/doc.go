// Package embeddings hosts background jobs that maintain the
// vector-embedding stores (currently the TTL sweeper that deletes
// rows whose expires_at has passed).
//
// Layer: platform
//
// First subpackage extracted under [internal/jobs] per ADR-011
// (bounded-context subpackages). This package is the canary slice
// for Phase R / R0.5: it validates the move recipe (doc.go layer
// declaration, package rename, alias-import convention, archmetrics
// report-mode descriptors) before the larger R6 batch reshuffles
// the remaining ai_*_indexer jobs.
//
// Naming: per Go style (golang.org/wiki/CodeReviewComments#package-
// names) the exported types drop the redundant `Embeddings` prefix
// because the package path already carries that context — callers
// write `embeddings.TTLResult`, not `embeddings.EmbeddingsTTLResult`.
//
// ADR-015 §I12 contract is unchanged: [RunTTL] re-checks ai_mode
// at execution time and returns ([TTLResult{}], nil) without
// touching the DB when mode='off'. See ttl.go for the full
// contract documentation.
package embeddings
