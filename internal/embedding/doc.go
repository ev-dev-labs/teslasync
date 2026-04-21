// Package embedding provides vector-embedding generation and semantic
// similarity search over vehicle data (drives, charges, alerts, daily
// summaries). It powers the AI chatbot's context retrieval.
//
// The package is split into three layers:
//
//  1. Provider — pluggable backend that turns text into a float32 vector
//     (OpenAI or a local stub for tests).
//  2. Service  — generates and upserts embeddings for domain entities
//     and runs cosine-similarity queries against the `embeddings` table.
//  3. Worker   — periodically sweeps the database for un-embedded rows
//     and backfills them in batches.
//
// All three are gated by EmbeddingConfig.Enabled so the feature can be
// shipped dark and enabled per deployment.
package embedding
