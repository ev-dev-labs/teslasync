// Package ocpp exposes the OCPP-J 1.6 charge points and sessions
// recorded by cmd/ocpp-server so mixed-fleet operators see non-Tesla
// charger activity inside the main app.
package ocpp

import (
	"context"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dbocpp "github.com/ev-dev-labs/teslasync/internal/database/ocpp"
)

// Reader is the read port over OCPP persistence. *dbocpp.Store satisfies it.
type Reader interface {
	ListChargePoints(ctx context.Context) ([]dbocpp.ChargePoint, error)
	ListSessions(ctx context.Context, chargePointID string, limit int) ([]dbocpp.SessionView, error)
}

// Handler serves the OCPP read endpoints. Stateless beyond its
// constructor input; safe for concurrent use.
type Handler struct {
	store Reader
}

// NewHandler wires the handler. Panics on nil store (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(store Reader) *Handler {
	if store == nil {
		panic("api/ocpp: nil store")
	}
	return &Handler{store: store}
}

// ListChargePoints serves GET /ocpp/charge-points.
func (h *Handler) ListChargePoints(w http.ResponseWriter, r *http.Request) {
	cps, err := h.store.ListChargePoints(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("ocpp: list charge points failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charge points")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, cps)
}

// ListSessions serves GET /ocpp/sessions?charge_point_id=&limit=.
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	limit, _ := apiparams.Pagination(r)
	sessions, err := h.store.ListSessions(r.Context(), r.URL.Query().Get("charge_point_id"), limit)
	if err != nil {
		log.Error().Err(err).Msg("ocpp: list sessions failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list OCPP sessions")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sessions)
}
