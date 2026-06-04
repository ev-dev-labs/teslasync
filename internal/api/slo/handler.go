package slo

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	slopkg "github.com/ev-dev-labs/teslasync/internal/slo"
)

// Handler exposes the live SLO board.
type Handler struct {
	catalog *slopkg.Catalog
	tracker *slopkg.Tracker
}

// NewHandler wires the handler. catalog may be nil when slo/catalog.yaml
// failed to load at boot — the handler then returns a 503 so the SPA can
// surface the misconfiguration honestly.
func NewHandler(catalog *slopkg.Catalog, tracker *slopkg.Tracker) *Handler {
	return &Handler{catalog: catalog, tracker: tracker}
}

// Snapshot is the GET handler.
func (h *Handler) Snapshot(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.catalog == nil || h.tracker == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
		return
	}
	snap, err := h.tracker.Snapshot(r.Context(), h.catalog)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, snap)
}
