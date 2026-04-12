package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// VehicleHandler handles vehicle HTTP endpoints.
type VehicleHandler struct {
	svc *vehiclesvc.Service
}

// NewVehicleHandler creates a new vehicle handler.
func NewVehicleHandler(svc *vehiclesvc.Service) *VehicleHandler {
	return &VehicleHandler{svc: svc}
}

// Register registers vehicle routes on the given router.
func (h *VehicleHandler) Register(r chi.Router) {
	r.Get("/vehicles", h.List)
	r.Get("/vehicles/{vehicleID}", h.GetByID)
	r.Post("/vehicles/{vehicleID}/refresh", h.Refresh)
	r.Delete("/vehicles/{vehicleID}", h.Delete)
}

// List returns all vehicles for the authenticated user.
func (h *VehicleHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.UserFromContext(r.Context())
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	vehicles, err := h.svc.GetByUserID(r.Context(), claims.UserID)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, vehicles)
}

// GetByID returns a single vehicle.
func (h *VehicleHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "vehicleID")

	v, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, v)
}

// Refresh triggers a Tesla API refresh for a vehicle.
func (h *VehicleHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "vehicleID")

	if err := h.svc.Refresh(r.Context(), id); err != nil {
		middleware.HandleError(w, err)
		return
	}

	v, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, v)
}

// Delete removes a vehicle.
func (h *VehicleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "vehicleID")

	if err := h.svc.Delete(r.Context(), id); err != nil {
		middleware.HandleError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
