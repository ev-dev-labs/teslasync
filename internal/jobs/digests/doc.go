// Package digests hosts AI-attributed digest cron jobs. Weekly digests
// and year-in-review pregeneration are fail-closed gates: every tick
// re-checks ai_mode and the per-feature toggle per ADR-015 §I12 #3 so a
// degraded settings table cannot leak digest emails, push notifications,
// or pre-rendered YIR pages to off-mode users.
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
// ADR-015 §I12 requires every Run* function to re-check ai_mode and the
// per-feature toggle at execution time. The off path returns {Skipped: 1}, nil
// without touching the database, the LLM, the digest renderer, or any external service.
package digests
