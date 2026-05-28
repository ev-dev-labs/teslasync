// Package indexers hosts the 7 AI-attributed RAG indexer cron jobs:
// charge-curve, docs, drive-summary, idle-drain, log-trace, route,
// and update-notes. All are fail-closed gates that re-check
// ai_mode + the per-feature toggle on every tick per ADR-015 §I12
// #3 — a degraded settings table must NOT silently leak embeddings
// to off-mode users.
//
// Layer: domain-adjacent (use case scheduled by a worker). Each
// indexer follows the canonical RAG indexer shape:
//
//	type <Topic>SettingsReader interface {
//	    AIMode(ctx context.Context) (string, error)
//	    AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
//	}
//
//	type <Topic>Result struct {
//	    Skipped, RowsConsidered, RowsIndexed, Failed int
//	}
//
//	func Run<Topic>(ctx, db, settings) (<Topic>Result, error) { ... }
//
// Bounded-context subpkg per ADR-011 §2 — alias suffix is
// `indexersjobs` when imported at composition roots that already
// import other internal/jobs/* subpackages:
//
//	import (
//	    indexersjobs "github.com/ev-dev-labs/teslasync/internal/jobs/indexers"
//	    triagejobs   "github.com/ev-dev-labs/teslasync/internal/jobs/triage"
//	    digestsjobs  "github.com/ev-dev-labs/teslasync/internal/jobs/digests"
//	)
//
// When the package is the sole jobs/ import at a callsite the
// alias is not required — `indexers.RunDrive(...)` reads cleanly.
//
// ADR-015 §I12 contract preserved verbatim across the Phase R6
// carve: every Run* function still re-checks ai_mode + the
// per-feature toggle at execution time AND returns
// {Skipped: 1}, nil for the off path without touching the
// database, the LLM, the vector store, or any external service.
// The off-mode invariant remains structurally provable.
package indexers
