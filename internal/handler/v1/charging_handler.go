package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// ChargingHandler handles charging session HTTP endpoints.
type ChargingHandler struct {
	svc *chargingsvc.Service
}

// NewChargingHandler creates a new charging handler.
func NewChargingHandler(svc *chargingsvc.Service) *ChargingHandler {
	return &ChargingHandler{svc: svc}
}

// Register registers charging routes on the given router.
func (h *ChargingHandler) Register(r chi.Router) {
	r.Get("/charging-sessions", h.List)
	r.Get("/charging-sessions/{sessionID}", h.GetByID)
}

// List returns charging sessions for the user's vehicles.
func (h *ChargingHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID := r.URL.Query().Get("vehicleId")
	if vehicleID == "" {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "vehicleId query parameter required")
		return
	}

	sessions, err := h.svc.GetByVehicleID(r.Context(), vehicleID)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, sessions)
}

// GetByID returns a single charging session.
func (h *ChargingHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "sessionID")

	session, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, session)
}
