package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/tripsvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// TripHandler handles trip HTTP endpoints.
type TripHandler struct {
	svc *tripsvc.Service
}

// NewTripHandler creates a new trip handler.
func NewTripHandler(svc *tripsvc.Service) *TripHandler {
	return &TripHandler{svc: svc}
}

// Register registers trip routes on the given router.
func (h *TripHandler) Register(r chi.Router) {
	r.Get("/trips", h.List)
	r.Get("/trips/{tripID}", h.GetByID)
}

// List returns trips for a vehicle.
func (h *TripHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID := r.URL.Query().Get("vehicleId")
	if vehicleID == "" {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "vehicleId query parameter required")
		return
	}

	trips, err := h.svc.GetByVehicleID(r.Context(), vehicleID)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, trips)
}

// GetByID returns a single trip.
func (h *TripHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "tripID")

	trip, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, trip)
}
