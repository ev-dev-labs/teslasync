// Package triage hosts the AI-attributed triage cron jobs:
// alert-inbox auto-categorization (Phase-50/0035) and
// feedback-queue re-embedding (Phase-50/0046). Both are
// fail-closed gates that re-check ai_mode + the per-feature
// toggle on every tick per ADR-015 §I12 #3 — a degraded
// settings table must NOT silently leak push notifications or
// LLM embeddings to off-mode users.
//
// Layer: app
// package depends only on internal/ai/rag (for AIModeOff) and
// internal/database (for the SettingsRepo type its inputs
// satisfy structurally via the narrow SettingsReader interfaces).
//
// Bounded-context subpkg per ADR-011 §2 — alias suffix is
// `triagejobs` when imported at composition roots that already
// import other internal/jobs/* subpackages:
//
//	import (
//	    triagejobs "github.com/ev-dev-labs/teslasync/internal/jobs/triage"
//	    embeddingsjobs "github.com/ev-dev-labs/teslasync/internal/jobs/embeddings"
//	)
//
// When the package is the sole jobs/ import at a callsite the
// alias is not required — `triage.RunAlertInbox(...)` reads
// cleanly.
//
// ADR-015 §I12 contract preserved verbatim across the Phase R6
// carve: every Run* function still re-checks ai_mode + the
// per-feature toggle at execution time AND returns
// {Skipped: 1}, nil for the off path without touching the
// database, the LLM, or any external service. The off-mode
// invariant remains structurally provable.
package triage
