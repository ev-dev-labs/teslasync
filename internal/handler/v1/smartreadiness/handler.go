// Package smartreadiness exposes private charging plans to verified recipients.
package smartreadiness

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

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type service interface {
	ListPlans(context.Context, string, int64, int, int) ([]domain.Plan, error)
	LatestStarts(context.Context, string, int64) ([]domain.LatestStart, error)
	SavePlan(context.Context, string, domain.Plan) (*domain.Plan, error)
	DeletePlan(context.Context, string, int64, int64) error
	SnoozePlan(context.Context, string, int64, int64, int64) error
}

type Handler struct {
	service    service
	headerName string
}

func NewHandler(service service, forwardAuthHeader string) *Handler {
	if service == nil {
		panic("smartreadiness.NewHandler: service must not be nil")
	}
	return &Handler{service: service, headerName: strings.TrimSpace(forwardAuthHeader)}
}

func (h *Handler) MountRoutes(r chi.Router) {
	writeLimit := httprate.LimitByIP(20, time.Minute)
	r.Route("/smart-charging", func(r chi.Router) {
		r.Get("/plans", h.ListPlans)
		r.Get("/latest-start", h.LatestStarts)
		r.With(writeLimit).Post("/plans", h.CreatePlan)
		r.With(writeLimit).Put("/plans/{planID}", h.UpdatePlan)
		r.With(writeLimit).Delete("/plans/{planID}", h.DeletePlan)
		r.With(writeLimit).Post("/plans/{planID}/snooze", h.SnoozePlan)
	})
}

func (h *Handler) LatestStarts(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.latest_starts")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging readiness")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	estimates, err := h.service.LatestStarts(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, estimates)
}

func (h *Handler) ListPlans(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.list_plans")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging readiness")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	limit, limitErr := boundedInt(r.URL.Query().Get("limit"), 50, 1, 100)
	offset, offsetErr := boundedInt(r.URL.Query().Get("offset"), 0, 0, 100000)
	if err != nil || limitErr != nil || offsetErr != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	plans, err := h.service.ListPlans(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, plans)
}

type planRequest struct {
	VehicleID        int64                  `json:"vehicle_id"`
	ChargingPlaceID  *int64                 `json:"charging_place_id"`
	Enabled          *bool                  `json:"enabled"`
	NotifyAt         *time.Time             `json:"notify_at"`
	DepartureAt      *time.Time             `json:"departure_at"`
	ScheduledStart   *domain.ScheduledStart `json:"scheduled_start"`
	TripUseLowPct    *float64               `json:"trip_use_low_pct"`
	TripUseHighPct   *float64               `json:"trip_use_high_pct"`
	TripLegs         *tripLegsRequest       `json:"trip_legs"`
	ReservePct       *float64               `json:"reserve_pct"`
	CompareSiteRates *bool                  `json:"compare_site_rates"`
}

type tripLegsRequest struct {
	OutboundUseLowPct    *float64 `json:"outbound_use_low_pct"`
	OutboundUseHighPct   *float64 `json:"outbound_use_high_pct"`
	ReturnUseLowPct      *float64 `json:"return_use_low_pct"`
	ReturnUseHighPct     *float64 `json:"return_use_high_pct"`
	DestinationChargePct *float64 `json:"destination_charge_pct"`
}

func (request planRequest) plan(id int64) (domain.Plan, error) {
	if request.Enabled == nil || request.NotifyAt == nil ||
		request.DepartureAt == nil || request.TripUseLowPct == nil ||
		request.TripUseHighPct == nil || request.ReservePct == nil {
		return domain.Plan{}, smartreadinesssvc.ErrInvalidInput
	}
	var legs *domain.TripLegs
	if request.TripLegs != nil {
		input := request.TripLegs
		if input.OutboundUseLowPct == nil || input.OutboundUseHighPct == nil ||
			input.ReturnUseLowPct == nil || input.ReturnUseHighPct == nil {
			return domain.Plan{}, smartreadinesssvc.ErrInvalidInput
		}
		legs = &domain.TripLegs{
			OutboundUseLowPct: *input.OutboundUseLowPct, OutboundUseHighPct: *input.OutboundUseHighPct,
			ReturnUseLowPct: *input.ReturnUseLowPct, ReturnUseHighPct: *input.ReturnUseHighPct,
			DestinationChargePct: input.DestinationChargePct,
		}
	}
	return domain.Plan{
		ID: id, VehicleID: request.VehicleID, ChargingPlaceID: request.ChargingPlaceID,
		Enabled: *request.Enabled, NotifyAt: *request.NotifyAt, DepartureAt: *request.DepartureAt,
		ScheduledStart: request.ScheduledStart,
		TripUseLowPct:  *request.TripUseLowPct, TripUseHighPct: *request.TripUseHighPct, TripLegs: legs,
		ReservePct: *request.ReservePct, CompareSiteRates: request.CompareSiteRates != nil && *request.CompareSiteRates,
	}, nil
}

func (h *Handler) CreatePlan(w http.ResponseWriter, r *http.Request) {
	h.savePlan(w, r, false)
}

func (h *Handler) UpdatePlan(w http.ResponseWriter, r *http.Request) {
	h.savePlan(w, r, true)
}

func (h *Handler) savePlan(w http.ResponseWriter, r *http.Request, update bool) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.save_plan")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging readiness")
	if !ok {
		return
	}
	var id int64
	var err error
	if update {
		id, err = positiveID(chi.URLParam(r, "planID"))
		if err != nil {
			h.handleError(w, span, err)
			return
		}
	}
	request, err := decode[planRequest](w, r)
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	plan, err := request.plan(id)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	saved, err := h.service.SavePlan(ctx, subject, plan)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	status := http.StatusCreated
	if update {
		status = http.StatusOK
	}
	httputil.Respond(w, status, saved)
}

func (h *Handler) DeletePlan(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.delete_plan")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging readiness")
	if !ok {
		return
	}
	planID, idErr := positiveID(chi.URLParam(r, "planID"))
	vehicleID, vehicleErr := positiveID(r.URL.Query().Get("vehicle_id"))
	if idErr != nil || vehicleErr != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	if err := h.service.DeletePlan(ctx, subject, vehicleID, planID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type snoozeRequest struct {
	VehicleID int64  `json:"vehicle_id"`
	DurationS *int64 `json:"duration_s"`
}

func (h *Handler) SnoozePlan(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.snooze_plan")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "charging readiness")
	if !ok {
		return
	}
	planID, err := positiveID(chi.URLParam(r, "planID"))
	request, decodeErr := decode[snoozeRequest](w, r)
	if err != nil || decodeErr != nil || request.DurationS == nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	if err := h.service.SnoozePlan(ctx, subject, request.VehicleID, planID, *request.DurationS); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid charging readiness request")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "charging readiness resource not found")
	case errors.Is(err, port.ErrLimit):
		httputil.RespondError(w, http.StatusConflict, "PLAN_LIMIT", "too many charging readiness plans")
	default:
		span.RecordError(errors.New("charging readiness request failed"))
		span.SetStatus(codes.Error, "charging readiness request failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("charging readiness request failed")
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "charging readiness request failed")
	}
}

func decode[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	return httputil.DecodeAndValidate[T](r)
}

func positiveID(value string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, smartreadinesssvc.ErrInvalidInput
	}
	return id, nil
}

func boundedInt(value string, fallback, min, max int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	result, err := strconv.Atoi(value)
	if err != nil || result < min || result > max {
		return 0, smartreadinesssvc.ErrInvalidInput
	}
	return result, nil
}
