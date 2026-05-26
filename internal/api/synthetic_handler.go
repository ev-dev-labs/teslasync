// Phase-46 / p46-synthetic — Synthetic monitoring board.
//
//	GET /api/v1/admin/observability/synthetic
//	  Returns the latest result for each registered probe — name,
//	  last_run_at, duration, status, current success/failure streak,
//	  and lifetime totals. Read-only.
//
// When no synthetic runner is wired (e.g. SYNTHETIC_ENABLED=false) the
// handler returns 503 SUBSYSTEM_NOT_CONFIGURED so the SPA can render
// "synthetic monitoring not running on this deployment" instead of an
// empty board.
//
// ADR-009 exception.
package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/synthetic"
)

// SyntheticHandler exposes the synthetic runner state.
type SyntheticHandler struct {
	runner *synthetic.Runner
}

// NewSyntheticHandler wires the handler. Pass nil when the runner is
// disabled — the handler will return 503.
func NewSyntheticHandler(runner *synthetic.Runner) *SyntheticHandler {
	return &SyntheticHandler{runner: runner}
}

// Snapshot is the GET handler.
func (h *SyntheticHandler) Snapshot(w http.ResponseWriter, _ *http.Request) {
	if h == nil || h.runner == nil {
		writeError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
		return
	}
	writeJSON(w, http.StatusOK, h.runner.Snapshot())
}
