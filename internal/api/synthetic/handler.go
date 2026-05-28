package synthetic

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	synthrun "github.com/ev-dev-labs/teslasync/internal/synthetic"
)

// Handler exposes the synthetic runner state.
type Handler struct {
	runner *synthrun.Runner
}

// NewHandler wires the handler. Pass nil when the runner is
// disabled — the handler will return 503.
func NewHandler(runner *synthrun.Runner) *Handler {
	return &Handler{runner: runner}
}

// Snapshot is the GET handler.
func (h *Handler) Snapshot(w http.ResponseWriter, _ *http.Request) {
	if h == nil || h.runner == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.runner.Snapshot())
}
