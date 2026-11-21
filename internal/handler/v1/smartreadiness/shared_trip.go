package smartreadiness

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type SharedTripService interface {
	ListOwnedTrips(context.Context, smartreadinesssvc.SharedTripActor, int, int) ([]domain.SharedTrip, error)
	ListInvitations(context.Context, smartreadinesssvc.SharedTripActor, int, int) ([]domain.SharedTripInvitation, error)
	SaveTrip(context.Context, smartreadinesssvc.SharedTripActor, domain.SharedTripDraft) (*domain.SharedTrip, error)
	CancelTrip(context.Context, smartreadinesssvc.SharedTripActor, int64, int64) error
	ConfirmVehicle(context.Context, smartreadinesssvc.SharedTripActor, domain.SharedTripEntryKey, domain.SharedTripConfirmationInput) error
	WithdrawVehicle(context.Context, smartreadinesssvc.SharedTripActor, domain.SharedTripEntryKey) error
	Comparison(context.Context, smartreadinesssvc.SharedTripActor, int64) (*domain.SharedTripComparison, error)
}

type SharedTripHandler struct {
	service    SharedTripService
	headerName string
}

// NewSharedTripHandler requires the same trusted ForwardAuth boundary as the
// rest of v1. The identity header is never a substitute for that middleware.
func NewSharedTripHandler(service SharedTripService, forwardAuthHeader string) *SharedTripHandler {
	if service == nil {
		panic("smartreadiness.NewSharedTripHandler: service must not be nil")
	}
	return &SharedTripHandler{service: service, headerName: strings.TrimSpace(forwardAuthHeader)}
}

// MountRoutes mounts at the /api/v1 group, not inside /smart-charging.
func (h *SharedTripHandler) MountRoutes(r chi.Router) {
	writeLimit := httprate.LimitByIP(20, time.Minute)
	r.Route("/smart-charging/shared-trips", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "private, no-store")
				next.ServeHTTP(w, r)
			})
		})
		r.Get("/", h.browser("list", h.list))
		r.With(writeLimit).Post("/", h.browser("create", h.save))
		r.With(writeLimit).Put("/{tripID}", h.browser("revise", h.save))
		r.With(writeLimit).Delete("/{tripID}", h.browser("cancel", h.cancel))
		r.With(writeLimit).Put("/{tripID}/vehicles/{vehicleID}", h.browser("confirm", h.confirm))
		r.With(writeLimit).Delete("/{tripID}/vehicles/{vehicleID}", h.browser("withdraw", h.withdraw))
		r.Get("/{tripID}/comparison", h.browser("compare", h.comparison))
	})
}

type sharedTripAction func(http.ResponseWriter, *http.Request, smartreadinesssvc.SharedTripActor) error

func (h *SharedTripHandler) browser(operation string, action sharedTripAction) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, span := otel.Tracer("api").Start(r.Context(), "shared_trip."+operation)
		defer span.End()
		subject, ok := verifiedSharedPlanningSubject(w, r, h.headerName)
		if !ok {
			return
		}
		if err := action(w, r.WithContext(ctx), smartreadinesssvc.SharedTripActor{Subject: subject, VerifiedBrowser: true}); err != nil {
			sharedTripError(w, span, err)
		}
	}
}

type sharedTripResponse struct {
	ID          int64     `json:"id"`
	Revision    int64     `json:"revision"`
	DepartureAt time.Time `json:"departure_at"`
}

func sharedTripDTO(trip domain.SharedTrip) sharedTripResponse {
	return sharedTripResponse{trip.ID, trip.Revision, trip.DepartureAt}
}

type sharedTripInvitationResponse struct {
	TripID           int64      `json:"trip_id"`
	Revision         int64      `json:"revision"`
	VehicleID        int64      `json:"vehicle_id"`
	EntryVersion     int64      `json:"entry_version"`
	DepartureAt      time.Time  `json:"departure_at"`
	ConsentExpiresAt *time.Time `json:"consent_expires_at"`
}

func (h *SharedTripHandler) list(w http.ResponseWriter, r *http.Request, actor smartreadinesssvc.SharedTripActor) error {
	query := r.URL.Query()
	limit, limitErr := boundedInt(query.Get("limit"), port.MaxSharedTripPageSize, 1, port.MaxSharedTripPageSize)
	offset, offsetErr := boundedInt(query.Get("offset"), 0, 0, port.MaxSharedTripPageOffset)
	if limitErr != nil || offsetErr != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	owned, ownedErr := h.service.ListOwnedTrips(r.Context(), actor, limit, offset)
	if ownedErr != nil && !errors.Is(ownedErr, smartreadinesssvc.ErrSharedTripOperatorRequired) {
		return ownedErr
	}
	invitations, err := h.service.ListInvitations(r.Context(), actor, limit, offset)
	if err != nil {
		return err
	}
	response := struct {
		CanManage   bool                           `json:"can_manage"`
		Owned       []sharedTripResponse           `json:"owned"`
		Invitations []sharedTripInvitationResponse `json:"invitations"`
	}{ownedErr == nil, make([]sharedTripResponse, 0, len(owned)), make([]sharedTripInvitationResponse, 0, len(invitations))}
	if response.CanManage {
		for _, trip := range owned {
			response.Owned = append(response.Owned, sharedTripDTO(trip))
		}
	}
	for _, entry := range invitations {
		response.Invitations = append(response.Invitations, sharedTripInvitationResponse{
			entry.TripID, entry.Revision, entry.VehicleID, entry.EntryVersion, entry.DepartureAt, entry.ConsentExpiresAt,
		})
	}
	httputil.Respond(w, http.StatusOK, response)
	return nil
}

type sharedTripSaveRequest struct {
	Revision    *int64    `json:"revision"`
	DepartureAt time.Time `json:"departure_at"`
	Nominations []struct {
		VehicleID int64  `json:"vehicle_id"`
		Subject   string `json:"subject"`
	} `json:"nominations"`
}

func (h *SharedTripHandler) save(w http.ResponseWriter, r *http.Request, actor smartreadinesssvc.SharedTripActor) error {
	request, err := decodeSharedPlanning[sharedTripSaveRequest](w, r)
	if err != nil {
		return err
	}
	draft := domain.SharedTripDraft{SharedTrip: domain.SharedTrip{DepartureAt: request.DepartureAt}}
	status := http.StatusCreated
	if r.Method == http.MethodPut {
		draft.ID, err = positiveID(chi.URLParam(r, "tripID"))
		if err != nil || request.Revision == nil || *request.Revision <= 0 {
			return smartreadinesssvc.ErrInvalidInput
		}
		draft.Revision, status = *request.Revision, http.StatusOK
	} else if request.Revision != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	for _, nomination := range request.Nominations {
		draft.Nominations = append(draft.Nominations, domain.SharedTripNomination{
			VehicleID: nomination.VehicleID, Subject: nomination.Subject,
		})
	}
	saved, err := h.service.SaveTrip(r.Context(), actor, draft)
	if err != nil {
		return err
	}
	httputil.Respond(w, status, sharedTripDTO(*saved))
	return nil
}

func (h *SharedTripHandler) cancel(w http.ResponseWriter, r *http.Request, actor smartreadinesssvc.SharedTripActor) error {
	tripID, err := positiveID(chi.URLParam(r, "tripID"))
	revision, revisionErr := sharedTripQueryID(r, "revision")
	if err != nil || revisionErr != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	if err := h.service.CancelTrip(r.Context(), actor, tripID, revision); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type sharedTripConfirmRequest struct {
	Revision         int64    `json:"revision"`
	EntryVersion     int64    `json:"entry_version"`
	TripUseLowPct    *float64 `json:"trip_use_low_pct"`
	TripUseHighPct   *float64 `json:"trip_use_high_pct"`
	ReservePct       *float64 `json:"reserve_pct"`
	ScheduleClear    *bool    `json:"schedule_clear"`
	MaintenanceClear *bool    `json:"maintenance_clear"`
}

func (h *SharedTripHandler) confirm(w http.ResponseWriter, r *http.Request, actor smartreadinesssvc.SharedTripActor) error {
	request, err := decodeSharedPlanning[sharedTripConfirmRequest](w, r)
	if err != nil {
		return err
	}
	key, err := sharedTripKey(r, request.Revision, request.EntryVersion)
	if err != nil {
		return err
	}
	input := domain.SharedTripConfirmationInput{
		TripUseLowPct: request.TripUseLowPct, TripUseHighPct: request.TripUseHighPct, ReservePct: request.ReservePct,
		ScheduleClear: request.ScheduleClear, MaintenanceClear: request.MaintenanceClear,
	}
	if err := h.service.ConfirmVehicle(r.Context(), actor, key, input); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *SharedTripHandler) withdraw(w http.ResponseWriter, r *http.Request, actor smartreadinesssvc.SharedTripActor) error {
	revision, revisionErr := sharedTripQueryID(r, "revision")
	version, versionErr := sharedTripQueryID(r, "entry_version")
	if revisionErr != nil || versionErr != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	key, err := sharedTripKey(r, revision, version)
	if err != nil {
		return err
	}
	if err := h.service.WithdrawVehicle(r.Context(), actor, key); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type sharedTripOptionResponse struct {
	VehicleID     int64     `json:"vehicle_id"`
	ReturnLowPct  float64   `json:"return_low_pct"`
	ReturnHighPct float64   `json:"return_high_pct"`
	ReservePct    float64   `json:"reserve_pct"`
	ObservedAt    time.Time `json:"observed_at"`
	ExpiresAt     time.Time `json:"expires_at"`
}

type sharedTripComparisonResponse struct {
	sharedTripResponse
	ExpiresAt time.Time                  `json:"expires_at"`
	Options   []sharedTripOptionResponse `json:"options"`
}

func (h *SharedTripHandler) comparison(w http.ResponseWriter, r *http.Request, actor smartreadinesssvc.SharedTripActor) error {
	tripID, err := positiveID(chi.URLParam(r, "tripID"))
	if err != nil {
		return err
	}
	result, err := h.service.Comparison(r.Context(), actor, tripID)
	if err != nil {
		return err
	}
	var comparison *sharedTripComparisonResponse
	if result != nil {
		comparison = &sharedTripComparisonResponse{
			sharedTripDTO(result.SharedTrip), result.ExpiresAt, make([]sharedTripOptionResponse, 0, len(result.Options)),
		}
		for _, option := range result.Options {
			comparison.Options = append(comparison.Options, sharedTripOptionResponse{
				option.VehicleID, option.ReturnLowPct, option.ReturnHighPct, option.ReservePct, option.ObservedAt, option.ExpiresAt,
			})
		}
	}
	httputil.Respond(w, http.StatusOK, struct {
		Comparison *sharedTripComparisonResponse `json:"comparison"`
	}{comparison})
	return nil
}

func sharedTripQueryID(r *http.Request, key string) (int64, error) {
	values := r.URL.Query()[key]
	if len(values) != 1 {
		return 0, smartreadinesssvc.ErrInvalidInput
	}
	return positiveID(values[0])
}

func sharedTripKey(r *http.Request, revision, entryVersion int64) (domain.SharedTripEntryKey, error) {
	tripID, tripErr := positiveID(chi.URLParam(r, "tripID"))
	vehicleID, vehicleErr := positiveID(chi.URLParam(r, "vehicleID"))
	if tripErr != nil || vehicleErr != nil || revision <= 0 || entryVersion <= 0 {
		return domain.SharedTripEntryKey{}, smartreadinesssvc.ErrInvalidInput
	}
	return domain.SharedTripEntryKey{TripID: tripID, Revision: revision, VehicleID: vehicleID, EntryVersion: entryVersion}, nil
}

func sharedTripError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid shared trip request")
	case errors.Is(err, smartreadinesssvc.ErrSharedTripOperatorRequired):
		httputil.RespondError(w, http.StatusForbidden, "SHARED_TRIP_OPERATOR_REQUIRED", "shared trip operator required")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "shared trip resource not found")
	default:
		safe := errors.New("shared trip request failed")
		span.RecordError(safe)
		span.SetStatus(codes.Error, safe.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(safe.Error())
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", safe.Error())
	}
}
