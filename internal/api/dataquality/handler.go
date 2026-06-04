package dataquality

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dqpkg "github.com/ev-dev-labs/teslasync/internal/dataquality"
)

// Handler serves data quality + lineage endpoints.
type Handler struct {
	scorer *dqpkg.Scorer
}

// NewHandler wires the handler. Pass nil for scorer when the signal_log
// pool wasn't available — the handler reports 503 on the per-field score
// endpoint but still serves the static lineage graph (which has no DB
// dependency).
func NewHandler(scorer *dqpkg.Scorer) *Handler {
	return &Handler{scorer: scorer}
}

// Score is GET /admin/observability/data-quality.
func (h *Handler) Score(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.scorer == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
		return
	}
	snap, err := h.scorer.Snapshot(r.Context())
	if err != nil {
		if errors.Is(err, dqpkg.ErrNotConfigured) {
			httpx.WriteError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, snap)
}

// Lineage is GET /admin/observability/lineage. Static so available on
// every deployment even if signal_log scoring is offline.
func (h *Handler) Lineage(w http.ResponseWriter, _ *http.Request) {
	graph, err := dqpkg.BuildLineage()
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, graph)
}
