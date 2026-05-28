// Package digests hosts the AI-attributed digest cron jobs:
// weekly drive-summary digest (Phase-50/0043 W2) and year-in-review
// pregeneration (Phase-50/0048 V5). Both are fail-closed gates that
// re-check ai_mode + the per-feature toggle on every tick per
// ADR-015 §I12 #3 — a degraded settings table must NOT silently
// leak digest emails, push notifications, or pre-rendered YIR
// pages to off-mode users.
//
// Layer: app
// package depends only on internal/ai/rag (for AIModeOff) and
// internal/database (for the SettingsRepo type its inputs satisfy
// structurally via the narrow SettingsReader interfaces).
//
// Bounded-context subpkg per ADR-011 §2 — alias suffix is
// `digestsjobs` when imported at composition roots that already
// import other internal/jobs/* subpackages:
//
//	import (
//	    digestsjobs "github.com/ev-dev-labs/teslasync/internal/jobs/digests"
//	    triagejobs  "github.com/ev-dev-labs/teslasync/internal/jobs/triage"
//	)
//
// When the package is the sole jobs/ import at a callsite the
// alias is not required — `digests.RunWeekly(...)` reads cleanly.
//
// ADR-015 §I12 contract preserved verbatim across the Phase R6
// carve: every Run* function still re-checks ai_mode + the
// per-feature toggle at execution time AND returns
// {Skipped: 1}, nil for the off path without touching the
// database, the LLM, the digest renderer, or any external service.
// The off-mode invariant remains structurally provable.
package digests
