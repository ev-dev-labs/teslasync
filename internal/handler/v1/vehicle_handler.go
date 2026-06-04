package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type VehicleHandler struct {
	svc *vehiclesvc.Service
}

func NewVehicleHandler(svc *vehiclesvc.Service) *VehicleHandler {
	return &VehicleHandler{svc: svc}
}

func (h *VehicleHandler) Register(r chi.Router) {
	r.Get("/vehicles", h.List)
	r.Get("/vehicles/{vehicleID}", h.GetByID)
	r.Post("/vehicles/{vehicleID}/refresh", h.Refresh)
	r.Delete("/vehicles/{vehicleID}", h.Delete)
}

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

func (h *VehicleHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "vehicleID")

	v, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, v)
}

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

func (h *VehicleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "vehicleID")

	if err := h.svc.Delete(r.Context(), id); err != nil {
		middleware.HandleError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
