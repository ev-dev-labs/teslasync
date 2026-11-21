// Package smartcommute exposes private routine setup to authenticated users.
package smartcommute

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
)

type service interface {
	Get(context.Context, string, int64) (*domain.Snapshot, error)
	SaveSettings(context.Context, string, domain.Settings) error
	Analyze(context.Context, string, int64) error
	CreateRoutine(context.Context, string, domain.RoutineInput) (*domain.Routine, error)
	ConfirmRoutine(context.Context, string, int64, domain.RoutineInput) (*domain.Routine, error)
	DeclineRoutine(context.Context, string, int64, int64) error
	SnoozeRoutine(context.Context, string, int64, int64, int64) error
	DeleteRoutine(context.Context, string, int64, int64) error
	DeleteAll(context.Context, string, int64) error
	PreviewTrafficTrace(context.Context, string, int64, int64, int64) (*domain.TrafficPreview, error)
	SaveTrafficConsent(context.Context, string, domain.TrafficConsentInput) error
	DeleteTrafficConsent(context.Context, string, int64, int64) error
	SkipTrafficToday(context.Context, string, int64, int64) error
	SendNavigation(context.Context, string, int64, domain.NavigationRequest) (domain.NavigationResult, error)
}

type Handler struct {
	service    service
	headerName string
}

func NewHandler(service service, forwardAuthHeader string) *Handler {
	if service == nil {
		panic("smartcommute.NewHandler: service must not be nil")
	}
	return &Handler{service: service, headerName: strings.TrimSpace(forwardAuthHeader)}
}

func (h *Handler) MountRoutes(r chi.Router) {
	writeLimit := httprate.LimitByIP(20, time.Minute)
	r.Route("/smart-commute", func(r chi.Router) {
		r.Get("/", h.Get)
		r.With(writeLimit).Put("/", h.SaveSettings)
		r.With(writeLimit).Delete("/", h.DeleteAll)
		r.With(writeLimit).Post("/analyses", h.Analyze)
		r.With(writeLimit).Post("/routines", h.CreateRoutine)
		r.With(writeLimit).Put("/routines/{routineID}", h.ConfirmRoutine)
		r.With(writeLimit).Post("/routines/{routineID}/decline", h.DeclineRoutine)
		r.With(writeLimit).Post("/routines/{routineID}/snooze", h.SnoozeRoutine)
		r.With(writeLimit).Delete("/routines/{routineID}", h.DeleteRoutine)
		r.With(writeLimit).Post("/routines/{routineID}/traffic-preview", h.PreviewTrafficTrace)
		r.With(writeLimit).Put("/routines/{routineID}/traffic-consent", h.SaveTrafficConsent)
		r.With(writeLimit).Delete("/routines/{routineID}/traffic-consent", h.DeleteTrafficConsent)
		r.With(writeLimit).Post("/routines/{routineID}/traffic-skip", h.SkipTrafficToday)
		r.With(writeLimit).Post("/routines/{routineID}/navigation", h.SendNavigation)
	})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.get")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	result, err := h.service.Get(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, result)
}

type settingsRequest struct {
	VehicleID            int64  `json:"vehicle_id"`
	Enabled              *bool  `json:"enabled"`
	LocalAnalysisEnabled *bool  `json:"local_analysis_enabled"`
	Paused               *bool  `json:"paused"`
	TimeZone             string `json:"time_zone"`
}

func (h *Handler) SaveSettings(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.save_settings")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	request, err := decode[settingsRequest](w, r)
	if err != nil || request.Enabled == nil || request.LocalAnalysisEnabled == nil || request.Paused == nil {
		h.handleError(w, span, smartcommutesvc.ErrInvalidInput)
		return
	}
	err = h.service.SaveSettings(ctx, subject, domain.Settings{
		VehicleID: request.VehicleID, Enabled: *request.Enabled, LocalAnalysisEnabled: *request.LocalAnalysisEnabled,
		Paused: *request.Paused, TimeZone: strings.TrimSpace(request.TimeZone),
	})
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type vehicleRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

func (h *Handler) Analyze(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.analyze")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	request, err := decode[vehicleRequest](w, r)
	if err != nil {
		h.handleError(w, span, smartcommutesvc.ErrInvalidInput)
		return
	}
	if err := h.service.Analyze(ctx, subject, request.VehicleID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type pointRequest struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
}

type routineRequest struct {
	VehicleID   int64         `json:"vehicle_id"`
	Name        string        `json:"name"`
	Weekday     *int          `json:"weekday"`
	DepartureS  *int          `json:"departure_s"`
	TimeZone    string        `json:"time_zone"`
	Origin      *pointRequest `json:"origin"`
	Destination *pointRequest `json:"destination"`
}

func (request routineRequest) input() (domain.RoutineInput, error) {
	if request.Weekday == nil || request.DepartureS == nil ||
		request.Origin == nil || request.Origin.Latitude == nil || request.Origin.Longitude == nil ||
		request.Destination == nil || request.Destination.Latitude == nil || request.Destination.Longitude == nil {
		return domain.RoutineInput{}, smartcommutesvc.ErrInvalidInput
	}
	return domain.RoutineInput{
		VehicleID: request.VehicleID, Name: request.Name, Weekday: time.Weekday(*request.Weekday),
		DepartureS: *request.DepartureS, TimeZone: strings.TrimSpace(request.TimeZone),
		Origin:      domain.Point{Latitude: *request.Origin.Latitude, Longitude: *request.Origin.Longitude},
		Destination: domain.Point{Latitude: *request.Destination.Latitude, Longitude: *request.Destination.Longitude},
	}, nil
}

func (h *Handler) CreateRoutine(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.create_routine")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	request, err := decode[routineRequest](w, r)
	if err != nil {
		h.handleError(w, span, smartcommutesvc.ErrInvalidInput)
		return
	}
	input, err := request.input()
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	result, err := h.service.CreateRoutine(ctx, subject, input)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusCreated, result)
}

func (h *Handler) ConfirmRoutine(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.confirm_routine")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[routineRequest](w, r)
	if err != nil {
		h.handleError(w, span, smartcommutesvc.ErrInvalidInput)
		return
	}
	input, err := request.input()
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	result, err := h.service.ConfirmRoutine(ctx, subject, routineID, input)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, result)
}

func (h *Handler) DeclineRoutine(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.decline_routine")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[vehicleRequest](w, r)
	if err != nil {
		h.handleError(w, span, smartcommutesvc.ErrInvalidInput)
		return
	}
	if err := h.service.DeclineRoutine(ctx, subject, request.VehicleID, routineID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type snoozeRequest struct {
	VehicleID int64  `json:"vehicle_id"`
	DurationS *int64 `json:"duration_s"`
}

func (h *Handler) SnoozeRoutine(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.snooze_routine")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[snoozeRequest](w, r)
	if err != nil || request.DurationS == nil {
		h.handleError(w, span, smartcommutesvc.ErrInvalidInput)
		return
	}
	if err := h.service.SnoozeRoutine(ctx, subject, request.VehicleID, routineID, *request.DurationS); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteRoutine(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.delete_routine")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if err := h.service.DeleteRoutine(ctx, subject, vehicleID, routineID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteAll(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.delete_all")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if err := h.service.DeleteAll(ctx, subject, vehicleID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) subject(w http.ResponseWriter, r *http.Request) (string, bool) {
	return personal.Subject(w, r, h.headerName, "smart commute")
}

func (h *Handler) handleError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartcommutesvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid smart commute request")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "smart commute resource not found")
	case errors.Is(err, port.ErrDisabled):
		httputil.RespondError(w, http.StatusConflict, "SMART_COMMUTE_DISABLED", "smart commute or local analysis is disabled")
	case errors.Is(err, port.ErrTooManyDrives):
		httputil.RespondError(w, http.StatusUnprocessableEntity, "HISTORY_LIMIT",
			"too many drives for a bounded local analysis")
	case errors.Is(err, port.ErrTrafficTraceUnavailable):
		httputil.RespondError(w, http.StatusUnprocessableEntity, "TRACE_UNAVAILABLE",
			"the selected drive has no suitable observed route trace")
	case errors.Is(err, port.ErrTrafficPreviewChanged):
		httputil.RespondError(w, http.StatusConflict, "TRACE_CHANGED", "review the updated representative trace before consenting")
	default:
		span.RecordError(errors.New("smart commute request failed"))
		span.SetStatus(codes.Error, "smart commute request failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("smart commute request failed")
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "smart commute request failed")
	}
}

func decode[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	return httputil.DecodeAndValidate[T](r)
}

func positiveID(value string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, smartcommutesvc.ErrInvalidInput
	}
	return id, nil
}
