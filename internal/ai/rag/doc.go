// Package rag is the single canonical retrieval surface for AI in
// TeslaSync (ADR-015 §I4 / §I7).
//
// Layer: platform
//
// One Retriever interface. Two implementations:
//
//   - NoopRetriever  — returned by [New] when ai_mode='off'. Every
//     method is a zero-side-effect no-op so a feature handler that
//     forgot to gate its call cannot leak data, write rows, or make
//     provider calls. The off-mode AI-Off Contract row count
//     invariant (ADR-015 §I4: COUNT(*) FROM embeddings_768 = 0 for
//     ai_mode='off' users) is enforced here at the type system.
//
//   - PgvectorRetriever — the production path. Embeds queries via the
//     audited [provider.Provider] resolved through the registry,
//     stores chunks in the pgvector-backed `embeddings_768` /
//     `embeddings_1536` tables (see migration 000206), and performs
//     cosine-similarity nearest-neighbour search over the HNSW index.
//
// Adding a new RAG-using feature does not touch this package: the
// feature calls Retrieve / Index / Forget against the interface, and
// the registry-resolved provider chain handles audit, redaction, rate
// limiting, and cost capping transparently.
//
// Background indexing
// -------------------
// The docs chatbot boots a docs indexer at startup; it constructs a
// Retriever via [New] and walks `docs/user/**/*.md` using [IndexDocs].
// The TTL cron in internal/jobs is started by [app.New] independently
// and self-skips when ai_mode='off'.
//
// ADR-015 invariants this package enforces
// ----------------------------------------
//
//	§I1  Default-off          — [New] returns NoopRetriever for off.
//	§I4  Zero outbound egress — Noop never calls Embed; pgvector
//	                            wraps ctx with WithSubject + WithFeatureID
//	                            so every Embed lands in ai_call_log.
//	§I7  Per-feature opt-in   — [PgvectorRetriever] resolves its
//	                            [provider.Provider] via the registry
//	                            on every call, so a per-feature
//	                            toggle flip takes effect without a
//	                            restart.
//	§I8  Survives downgrade   — rows are persisted, never auto-purged
//	                            on a mode flip; the TTL cron is the
//	                            only deletion path (apart from
//	                            explicit Forget).
package rag
