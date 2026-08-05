package fleetops

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

const maxBodyBytes = 64 << 10

type fleetOpsService interface {
	ListDrivers(context.Context, dbfleetops.DriverFilter) (*models.FleetPage[models.FleetDriver], error)
	GetDriver(context.Context, int64) (*models.FleetDriver, error)
	CreateDriver(context.Context, *models.FleetDriver) error
	UpdateDriver(context.Context, *models.FleetDriver) error
	DeleteDriver(context.Context, int64, int) error

	ListCostCenters(context.Context, dbfleetops.CostCenterFilter) (*models.FleetPage[models.FleetCostCenter], error)
	GetCostCenter(context.Context, int64) (*models.FleetCostCenter, error)
	CreateCostCenter(context.Context, *models.FleetCostCenter) error
	UpdateCostCenter(context.Context, *models.FleetCostCenter) error
	DeleteCostCenter(context.Context, int64, int) error

	ListAssignments(context.Context, dbfleetops.AssignmentFilter) (*models.FleetPage[models.FleetVehicleDriverAssignment], error)
	GetAssignment(context.Context, int64) (*models.FleetVehicleDriverAssignment, error)
	CreateAssignment(context.Context, *models.FleetVehicleDriverAssignment) error
	UpdateAssignment(context.Context, *models.FleetVehicleDriverAssignment) error
	DeleteAssignment(context.Context, int64, int) error

	ListReservations(context.Context, dbfleetops.ReservationFilter) (*models.FleetPage[models.FleetReservation], error)
	GetReservation(context.Context, int64) (*models.FleetReservation, error)
	CreateReservation(context.Context, *models.FleetReservation) error
	UpdateReservation(context.Context, *models.FleetReservation) error
	DeleteReservation(context.Context, int64, int) error

	ListChargingPolicies(context.Context, dbfleetops.ChargingPolicyFilter) (*models.FleetPage[models.FleetChargingPolicy], error)
	GetChargingPolicy(context.Context, int64) (*models.FleetChargingPolicy, error)
	CreateChargingPolicy(context.Context, *models.FleetChargingPolicy) error
	UpdateChargingPolicy(context.Context, *models.FleetChargingPolicy) error
	DeleteChargingPolicy(context.Context, int64, int) error

	ListWorkOrders(context.Context, dbfleetops.WorkOrderFilter) (*models.FleetPage[models.FleetMaintenanceWorkOrder], error)
	GetWorkOrder(context.Context, int64) (*models.FleetMaintenanceWorkOrder, error)
	CreateWorkOrder(context.Context, *models.FleetMaintenanceWorkOrder) error
	UpdateWorkOrder(context.Context, *models.FleetMaintenanceWorkOrder) error
	DeleteWorkOrder(context.Context, int64, int) error

	UtilizationForecast(context.Context, *int64, time.Time, time.Time) (*models.FleetUtilizationForecast, error)
}

type Handler struct {
	service fleetOpsService
}

func NewHandler(db *database.DB) *Handler {
	repo := dbfleetops.NewRepository(db)
	return &Handler{service: NewService(repo)}
}

func newHandler(service fleetOpsService) *Handler {
	return &Handler{service: service}
}

// MountRoutes mounts all feature-8 routes. The parent router calls this inside
// its /api/v1 group; request paths therefore resolve under /api/v1/fleet-ops.
// Every write receives a per-IP limit of 30 requests per minute.
func MountRoutes(r chi.Router, h *Handler) {
	writeLimit := httprate.LimitByIP(30, time.Minute)
	r.Route("/fleet-ops", func(r chi.Router) {
		mountCRUD := func(path string, list, create, get, update, remove http.HandlerFunc) {
			r.Get(path, list)
			r.With(writeLimit).Post(path, create)
			r.Get(path+"/{id}", get)
			r.With(writeLimit).Put(path+"/{id}", update)
			r.With(writeLimit).Delete(path+"/{id}", remove)
		}
		mountCRUD("/drivers", h.ListDrivers, h.CreateDriver, h.GetDriver, h.UpdateDriver, h.DeleteDriver)
		mountCRUD("/cost-centers", h.ListCostCenters, h.CreateCostCenter, h.GetCostCenter, h.UpdateCostCenter, h.DeleteCostCenter)
		mountCRUD("/assignments", h.ListAssignments, h.CreateAssignment, h.GetAssignment, h.UpdateAssignment, h.DeleteAssignment)
		mountCRUD("/reservations", h.ListReservations, h.CreateReservation, h.GetReservation, h.UpdateReservation, h.DeleteReservation)
		mountCRUD("/charging-policies", h.ListChargingPolicies, h.CreateChargingPolicy, h.GetChargingPolicy, h.UpdateChargingPolicy, h.DeleteChargingPolicy)
		mountCRUD("/work-orders", h.ListWorkOrders, h.CreateWorkOrder, h.GetWorkOrder, h.UpdateWorkOrder, h.DeleteWorkOrder)
		r.Get("/utilization-forecast", h.UtilizationForecast)
	})
}

func startHandlerSpan(r *http.Request, name string) (context.Context, trace.Span) {
	return otel.Tracer("api").Start(r.Context(), "fleetops."+name)
}

func decodeBody(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	reader := http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			httpx.WriteError(w, http.StatusBadRequest, "request body is required")
		} else {
			httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		}
		return false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		httpx.WriteError(w, http.StatusBadRequest, "request body must contain one JSON object")
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "id must be a positive integer")
		return 0, false
	}
	return id, true
}

func deleteVersion(w http.ResponseWriter, r *http.Request) (int, bool) {
	version, err := strconv.Atoi(r.URL.Query().Get("version"))
	if err != nil || version <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "version query parameter must be a positive integer")
		return 0, false
	}
	return version, true
}

func optionalID(raw, name string) (*int64, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return nil, validation(name + " must be a positive integer")
	}
	return &value, nil
}

func optionalBool(raw, name string) (*bool, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return nil, validation(name + " must be true or false")
	}
	return &value, nil
}

func optionalTime(raw, name string) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, validation(name + " must be RFC3339")
	}
	value = value.UTC()
	return &value, nil
}

func writeHandlerError(ctx context.Context, span trace.Span, w http.ResponseWriter, operation string, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, operation)
	status := http.StatusInternalServerError
	message := "internal server error"
	switch {
	case errors.Is(err, ErrValidation):
		status = http.StatusBadRequest
		var domainErr *DomainError
		if errors.As(err, &domainErr) {
			message = domainErr.Message
		} else {
			message = "invalid fleet operations request"
		}
	case errors.Is(err, dbfleetops.ErrNotFound):
		status = http.StatusNotFound
		message = "fleet operations record not found"
	case errors.Is(err, dbfleetops.ErrVersionConflict):
		status = http.StatusConflict
		message = "record changed since it was loaded; refresh and try again"
	case errors.Is(err, dbfleetops.ErrDriverUnavailable):
		status = http.StatusConflict
		message = "driver is not assigned to this vehicle for the reservation period"
	case errors.Is(err, dbfleetops.ErrConflict):
		status = http.StatusConflict
		message = "the requested period or unique value conflicts with an existing record"
	}
	if status >= 500 {
		traceID := trace.SpanContextFromContext(ctx).TraceID().String()
		log.Error().Err(err).Str("trace_id", traceID).Str("operation", operation).
			Msg("fleet operations handler failed")
	}
	httpx.WriteError(w, status, message)
}

func writeNotFound(w http.ResponseWriter, entity string) {
	httpx.WriteError(w, http.StatusNotFound, entity+" not found")
}

func listPage(r *http.Request) (int, int) {
	limit, offset := apiparams.Pagination(r)
	if limit > 100 {
		limit = 50
	}
	return limit, offset
}

func validEnum(value string, allowed ...string) bool {
	if value == "" {
		return true
	}
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func requiredText(value string) bool {
	return strings.TrimSpace(value) != ""
}
