package slo

import (
	"context"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	slopkg "github.com/ev-dev-labs/teslasync/internal/slo"

	"github.com/rs/zerolog/log"
)

// snapshotter is the port the handler depends on from the SLO tracker.
// Declaring it here (rather than reaching for the concrete
// *slopkg.Tracker) keeps the handler decoupled from Prometheus wiring and
// lets tests drive the error boundary without standing up a real
// Prometheus — mirroring the PromQuerier port slopkg.Tracker itself uses.
type snapshotter interface {
	Snapshot(ctx context.Context, catalog *slopkg.Catalog) (*slopkg.Snapshot, error)
}

// Compile-time guarantee that the production tracker satisfies the port;
// a signature drift in slopkg.Tracker.Snapshot fails the build here.
var _ snapshotter = (*slopkg.Tracker)(nil)

// Handler exposes the live SLO board.
type Handler struct {
	catalog *slopkg.Catalog
	tracker snapshotter
}

// NewHandler wires the handler. catalog may be nil when slo/catalog.yaml
// failed to load at boot — the handler then returns a 503 so the SPA can
// surface the misconfiguration honestly. A nil *slopkg.Tracker is treated
// the same way: it is deliberately NOT stored in the interface field,
// because assigning a typed-nil pointer would make the interface non-nil
// and silently defeat the nil guard in Snapshot.
func NewHandler(catalog *slopkg.Catalog, tracker *slopkg.Tracker) *Handler {
	h := &Handler{catalog: catalog}
	if tracker != nil {
		h.tracker = tracker
	}
	return h
}

// Snapshot is the GET handler.
func (h *Handler) Snapshot(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.catalog == nil || h.tracker == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
		return
	}
	snap, err := h.tracker.Snapshot(r.Context(), h.catalog)
	if err != nil {
		// Log the internal detail at the boundary and return a generic
		// message so Prometheus/query internals don't leak to the SPA.
		log.Error().Err(err).Msg("slo.snapshot: tracker evaluation failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to evaluate SLOs")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, snap)
}
