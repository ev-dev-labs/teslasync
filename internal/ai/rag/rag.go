package rag

import (
	"context"
	"errors"
	"fmt"
	"sort"
)

// Source-type literals shared across the codebase. The TTL policy
// (see [TTLPolicy]) and the dedupe-table choice both key off these
// strings, so consumer slices MUST use the constants rather than
// inline string literals to avoid drift.
const (
	SourceDocs          = "docs"
	SourceDriveSummary  = "drive_summary"
	SourceChargeSession = "charge_session"
	SourceAlertHistory  = "alert_history"
	SourceAutomationRun = "automation_run"
	SourceUserNote      = "user_note"
)

// Embedding model names supported by the retriever. Adding a new
// model requires:
//  1. Adding it here with the correct dimension in [modelDims].
//  2. Confirming the cost table in internal/ai/cost has an entry.
//  3. Confirming the chosen physical table (768 vs 1536) is correct
//     — VECTOR(N) is fixed-size per column, so a model with a new
//     dim needs a new table (and a new migration).
const (
	ModelNomicEmbedText      = "nomic-embed-text"       // PD3 local, 768-dim
	ModelTextEmbedding3Small = "text-embedding-3-small" // PD3 cloud, 1536-dim
)

// modelDims maps a vendor embedding model name to its vector
// dimensionality. The retriever picks the physical table
// (`embeddings` for 768-dim, `embeddings_1536` for 1536-dim) based on
// this. An unknown model is rejected at [New] time so a typo in
// settings cannot silently route to the wrong table or fail at insert
// time after a paid embed call has already been made.
var modelDims = map[string]int{
	ModelNomicEmbedText:      768,
	ModelTextEmbedding3Small: 1536,
}

// Physical table names. Pinned constants so the SQL builders never
// rely on stringly-typed literals — a typo in a query string would
// surface only on a deployed cluster, not at compile time.
//
// Naming variance vs the prompt
// -----------------------------
// The prompt names the 768-dim table simply `embeddings`. Migration
// 000142 (baseline_typed) already created an unrelated table with
// that name (vector(384), entity_type/entity_id, never wired to any
// production code path). Rather than DROP-and-recreate the legacy
// table — a destructive operation across an arbitrary deployment —
// we name our new table `embeddings_768` so the new schema lives
// alongside the legacy one. The symmetric naming
// (embeddings_768 + embeddings_1536) is also clearer at a glance.
const (
	TableEmbeddings768  = "embeddings_768"
	TableEmbeddings1536 = "embeddings_1536"
)

// MaxK is the upper bound on Retriever.Retrieve's k parameter. 100
// is a generous ceiling for any conversational RAG context window
// (typical k is 4..16) and keeps a buggy caller from triggering a
// full vector scan that would dominate the request budget.
const MaxK = 100

// MaxChunkBytes is the hard cap on a single chunk's text length.
// pgvector itself has no limit, but the embedding APIs do (OpenAI
// rejects > 8191 tokens, Ollama practically caps at ~32k bytes for
// the 768-dim local model). The chunker enforces this via
// [Chunk]; the retriever rejects oversized inputs at Index time.
const MaxChunkBytes = 32 * 1024

// Errors exported by the rag package. Wrapped (errors.Is) by callers
// so the consumer can branch on the failure mode without parsing
// strings.
var (
	// ErrUnknownModel is returned by [New] when the configured
	// embedding model has no entry in [modelDims]. Fail-closed
	// behaviour: rather than default to 768 and silently route a
	// 1536-dim provider's vectors into the wrong table, the
	// constructor refuses to build.
	ErrUnknownModel = errors.New("rag: unknown embedding model")

	// ErrEmptyQuery is returned by Retrieve when query == "".
	// Embedding an empty string is a programmer error; the cost is
	// non-zero and the result is meaningless.
	ErrEmptyQuery = errors.New("rag: query must not be empty")

	// ErrInvalidK is returned by Retrieve when k <= 0 or k > MaxK.
	ErrInvalidK = errors.New("rag: k out of range")

	// ErrEmptySource is returned by Index/Forget when source_type or
	// source_id is empty — both are NOT NULL CHECK > 0 in the table.
	ErrEmptySource = errors.New("rag: source_type and source_id must be non-empty")

	// ErrChunkTooLarge is returned by Index when a chunk exceeds
	// [MaxChunkBytes]. The chunker should have split it; raising
	// here is a safety net for callers that pre-chunked their text.
	ErrChunkTooLarge = errors.New("rag: chunk exceeds MaxChunkBytes")

	// ErrDimMismatch is returned when a provider returns a vector
	// whose length does not match the configured model's dimension.
	// Indicates a model/config drift; the retriever refuses to
	// insert a wrong-dim row.
	ErrDimMismatch = errors.New("rag: provider returned vector with unexpected dimension")
)

// Chunk is one result returned by [Retriever.Retrieve], ordered by relevance.
// PgvectorRetriever returns raw cosine similarity in [-1, 1];
// LexicalDocsRetriever returns normalized BM25 relevance in (0, 1].
type Chunk struct {
	SourceType string  // matches one of the Source* constants.
	SourceID   string  // domain key (drive_id, doc filepath, etc).
	ChunkIdx   int     // 0-based; chunk position within the source.
	Text       string  // post-redaction chunk text.
	Score      float32 // implementation-specific relevance score.
}

// Retriever is the single canonical RAG entry point. Every
// AI feature that needs similarity search consumes this interface;
// no feature instantiates its own embedding query path.
//
// Implementations MUST honour ctx cancellation — both Embed (via
// the underlying provider) and the SQL queries take ctx.
type Retriever interface {
	// Retrieve finds the top-k nearest chunks to query across the
	// supplied sourceTypes. An empty sourceTypes slice means "all
	// source types". userSubject scopes the search to the calling
	// principal (mirrors ai_call_log.user_subject); single-tenant
	// installations pass "" and the global docs corpus (also
	// stored under user_subject="") is the natural match.
	//
	// Returns ([], nil) for off-mode (NoopRetriever); a real error
	// only on database / embed failure.
	Retrieve(ctx context.Context, userSubject, query string, sourceTypes []string, k int) ([]Chunk, error)

	// Index upserts the supplied chunks under (userSubject, sourceType,
	// sourceID), embedding any chunk whose text_hash differs from
	// the stored row (or whose row is missing). Chunks beyond
	// len(chunks) for the same source are DELETEd in the same
	// transaction so a shrunk source cannot leak stale chunks
	// through subsequent retrieval calls.
	//
	// Returns nil for off-mode (NoopRetriever).
	Index(ctx context.Context, userSubject, sourceType, sourceID string, chunks []string) error

	// Forget removes every chunk for (userSubject, sourceType,
	// sourceID). Used by consumer slices when the underlying
	// domain object is deleted (e.g. user removes a drive). Idempotent.
	Forget(ctx context.Context, userSubject, sourceType, sourceID string) error
}

// DimFor returns the vector dimensionality for a registered
// embedding model. The boolean reports whether the model is known.
// Callers (the factory) should treat unknown as a fatal config error.
func DimFor(model string) (int, bool) {
	d, ok := modelDims[model]
	return d, ok
}

// KnownModels returns every registered embedding model name in
// deterministic order. Used by the cost table snapshot test and the
// settings-UI model picker.
func KnownModels() []string {
	out := make([]string, 0, len(modelDims))
	for m := range modelDims {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// tableForDim returns the physical table name for a given vector
// dimension, or "" if no table supports the requested dim.
func tableForDim(dim int) string {
	switch dim {
	case 768:
		return TableEmbeddings768
	case 1536:
		return TableEmbeddings1536
	default:
		return ""
	}
}

// validateRetrieveArgs is shared by NoopRetriever (which still
// validates so callers see consistent errors across modes) and
// PgvectorRetriever. The off-mode short-circuit happens AFTER
// validation so a bug in the caller is caught the same way in both
// modes.
func validateRetrieveArgs(query string, k int) error {
	if query == "" {
		return ErrEmptyQuery
	}
	if k <= 0 || k > MaxK {
		return fmt.Errorf("%w: got %d, want 1..%d", ErrInvalidK, k, MaxK)
	}
	return nil
}

// validateIndexArgs is shared by NoopRetriever and PgvectorRetriever.
func validateIndexArgs(sourceType, sourceID string, chunks []string) error {
	if sourceType == "" || sourceID == "" {
		return ErrEmptySource
	}
	for i, c := range chunks {
		if len(c) > MaxChunkBytes {
			return fmt.Errorf("%w: chunk %d is %d bytes (max %d)", ErrChunkTooLarge, i, len(c), MaxChunkBytes)
		}
	}
	return nil
}

// validateForgetArgs is shared by NoopRetriever and PgvectorRetriever.
func validateForgetArgs(sourceType, sourceID string) error {
	if sourceType == "" || sourceID == "" {
		return ErrEmptySource
	}
	return nil
}
