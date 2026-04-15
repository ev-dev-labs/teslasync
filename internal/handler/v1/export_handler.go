package v1

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// ExportHandler handles export job HTTP endpoints.
type ExportHandler struct {
	svc *exportsvc.Service
}

// NewExportHandler creates a new export handler.
func NewExportHandler(svc *exportsvc.Service) *ExportHandler {
	return &ExportHandler{svc: svc}
}

// Register registers export routes on the given router.
func (h *ExportHandler) Register(r chi.Router) {
	r.Post("/exports", h.Create)
	r.Get("/exports/{exportID}", h.GetByID)
}

// Create creates a new export job.
func (h *ExportHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.UserFromContext(r.Context())
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	req, err := httputil.DecodeAndValidate[createExportRequest](r)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	job := &export.ExportJob{
		ID:        generateID(),
		UserID:    claims.UserID,
		Format:    req.Format,
		VehicleID: req.VehicleID,
		DateFrom:  req.DateFrom,
		DateTo:    req.DateTo,
	}

	if err := h.svc.Create(r.Context(), job); err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusCreated, job)
}

// GetByID returns an export job by ID.
func (h *ExportHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "exportID")

	job, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, job)
}

type createExportRequest struct {
	Format    string    `json:"format"`
	VehicleID string    `json:"vehicleId"`
	DateFrom  time.Time `json:"dateFrom"`
	DateTo    time.Time `json:"dateTo"`
}
