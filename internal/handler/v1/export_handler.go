package v1

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// ExportHandler handles export job HTTP endpoints.
type ExportHandler struct {
	svc        *exportsvc.Service
	headerName string
}

// NewExportHandler wires export endpoints to the export service.
func NewExportHandler(svc *exportsvc.Service, headerName string) *ExportHandler {
	return &ExportHandler{svc: svc, headerName: headerName}
}

func (h *ExportHandler) Register(r chi.Router) {
	r.Post("/exports", h.Create)
	r.Get("/exports/{exportID}", h.GetByID)
}

func (h *ExportHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "export.create")
	defer span.End()
	r = r.WithContext(ctx)
	subject, ok := tsauth.RequestSubject(r, h.headerName)
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	req, err := httputil.DecodeAndValidate[createExportRequest](r)
	if err != nil {
		span.RecordError(err)
		middleware.HandleError(w, err)
		return
	}

	job := &export.ExportJob{
		ID:        generateID(),
		UserID:    subject,
		Format:    req.Format,
		VehicleID: req.VehicleID,
		DateFrom:  req.DateFrom,
		DateTo:    req.DateTo,
	}

	if err := h.svc.Create(r.Context(), job); err != nil {
		span.RecordError(err)
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusCreated, job)
}

func (h *ExportHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "export.get")
	defer span.End()
	r = r.WithContext(ctx)
	id := chi.URLParam(r, "exportID")

	job, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		span.RecordError(err)
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
