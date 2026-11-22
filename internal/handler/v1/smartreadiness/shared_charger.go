package smartreadiness

import (
	"context"
	"errors"
	"net/http"
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
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type sharedChargerService interface {
	ListPlanning(context.Context, string, int, int) (port.SharedChargerPlanning, error)
	Authorize(context.Context, string, domain.SharedChargerRef, domain.SharedChargerAuthorization) (domain.SharedChargerRef, error)
	Confirm(context.Context, string, domain.SharedChargerRef, int64, smartreadinesssvc.SharedChargerConfirmationInput) error
	Withdraw(context.Context, string, domain.SharedChargerRef, int64) error
	Revoke(context.Context, string, domain.SharedChargerRef) error
	Card(context.Context, string, domain.SharedChargerRef) (*domain.SharedChargerCard, error)
	Reminder(context.Context, string, domain.SharedChargerRef) (*domain.SharedChargerReminder, error)
}

type SharedChargerHandler struct {
	service    sharedChargerService
	headerName string
}

func NewSharedChargerHandler(service sharedChargerService, forwardAuthHeader string) *SharedChargerHandler {
	if service == nil {
		panic("smartreadiness.NewSharedChargerHandler: service must not be nil")
	}
	return &SharedChargerHandler{service: service, headerName: strings.TrimSpace(forwardAuthHeader)}
}

func (h *SharedChargerHandler) MountRoutes(r chi.Router) {
	write := r.With(httprate.Limit(20, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP),
		httprate.WithLimitHandler(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Cache-Control", "private, no-store")
			httputil.RespondError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many shared charger planning changes")
		}),
	))
	r.Get("/smart-charging/shared-chargers", h.browser("list", h.list))
	write.Post("/smart-charging/shared-chargers", h.browser("create", h.authorize))
	write.Put("/smart-charging/shared-chargers/{planID}", h.browser("revise", h.authorize))
	write.Delete("/smart-charging/shared-chargers/{planID}", h.browser("revoke", h.revoke))
	write.Put("/smart-charging/shared-chargers/{planID}/vehicles/{vehicleID}", h.browser("confirm", h.confirm))
	write.Delete("/smart-charging/shared-chargers/{planID}/vehicles/{vehicleID}", h.browser("withdraw", h.withdraw))
	r.Get("/smart-charging/shared-chargers/{planID}/card", h.browser("card", h.card))
}

type sharedChargerEndpoint func(http.ResponseWriter, *http.Request, string) error

func (h *SharedChargerHandler) browser(action string, endpoint sharedChargerEndpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, span := otel.Tracer("api").Start(r.Context(), "shared_charger."+action)
		defer span.End()
		subject, ok := verifiedSharedPlanningSubject(w, r, h.headerName)
		if !ok {
			return
		}
		if err := endpoint(w, r.WithContext(ctx), subject); err != nil {
			writeSharedChargerError(w, span, err)
		}
	}
}

type sharedChargerRefResponse struct {
	ID       int64 `json:"id"`
	Revision int64 `json:"revision"`
}

func sharedChargerRefDTO(ref domain.SharedChargerRef) sharedChargerRefResponse {
	return sharedChargerRefResponse{ID: ref.ID, Revision: ref.Revision}
}

type sharedChargerOwnerResponse struct {
	sharedChargerRefResponse
	PlaceID   int64     `json:"place_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

type sharedChargerInvitationResponse struct {
	sharedChargerOwnerResponse
	VehicleID       int64     `json:"vehicle_id"`
	PlaceUpdatedAt  time.Time `json:"place_updated_at"`
	ReminderOffered bool      `json:"reminder_offered"`
	Confirmed       bool      `json:"confirmed"`
}

type sharedChargerListResponse struct {
	CanManage   bool                              `json:"can_manage"`
	Owned       []sharedChargerOwnerResponse      `json:"owned"`
	Invitations []sharedChargerInvitationResponse `json:"invitations"`
}

func (h *SharedChargerHandler) list(w http.ResponseWriter, r *http.Request, subject string) error {
	limit, err := boundedInt(r.URL.Query().Get("limit"), 32, 1, 50)
	offset, offsetErr := boundedInt(r.URL.Query().Get("offset"), 0, 0, 10000)
	if err != nil || offsetErr != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	result, err := h.service.ListPlanning(r.Context(), subject, limit, offset)
	if err != nil {
		return err
	}
	response := sharedChargerListResponse{
		CanManage: result.CanManage, Owned: make([]sharedChargerOwnerResponse, 0, len(result.Owned)),
		Invitations: make([]sharedChargerInvitationResponse, 0, len(result.Invitations)),
	}
	for _, owner := range result.Owned {
		response.Owned = append(response.Owned, sharedChargerOwnerResponse{
			sharedChargerRefResponse: sharedChargerRefDTO(owner.Ref), PlaceID: owner.PlaceID, ExpiresAt: owner.ExpiresAt,
		})
	}
	for _, invite := range result.Invitations {
		response.Invitations = append(response.Invitations, sharedChargerInvitationResponse{
			sharedChargerOwnerResponse: sharedChargerOwnerResponse{
				sharedChargerRefResponse: sharedChargerRefDTO(invite.Ref), PlaceID: invite.PlaceID, ExpiresAt: invite.ExpiresAt,
			},
			VehicleID: invite.VehicleID, PlaceUpdatedAt: invite.PlaceUpdatedAt,
			ReminderOffered: invite.ReminderOffered, Confirmed: invite.Confirmed,
		})
	}
	httputil.Respond(w, http.StatusOK, response)
	return nil
}

type sharedChargerAuthorizationRequest struct {
	PlaceID        int64     `json:"place_id"`
	PlaceUpdatedAt time.Time `json:"place_updated_at"`
	Participants   []struct {
		VehicleID int64  `json:"vehicle_id"`
		Subject   string `json:"subject"`
	} `json:"participants"`
	ReminderVehicleID int64     `json:"reminder_vehicle_id"`
	ExpiresAt         time.Time `json:"expires_at"`
}

func (h *SharedChargerHandler) authorize(w http.ResponseWriter, r *http.Request, subject string) error {
	var expected domain.SharedChargerRef
	status := http.StatusCreated
	if r.Method == http.MethodPut {
		var err error
		expected, err = sharedChargerRefFromRequest(r)
		if err != nil {
			return err
		}
		status = http.StatusOK
	}
	request, err := decodeSharedPlanning[sharedChargerAuthorizationRequest](w, r)
	if err != nil || len(request.Participants) != 2 {
		return smartreadinesssvc.ErrInvalidInput
	}
	spec := domain.SharedChargerAuthorization{
		PlaceID: request.PlaceID, PlaceUpdatedAt: request.PlaceUpdatedAt,
		ReminderVehicleID: request.ReminderVehicleID, ExpiresAt: request.ExpiresAt,
	}
	for i, member := range request.Participants {
		spec.Participants[i] = domain.SharedChargerParticipant{VehicleID: member.VehicleID, Subject: member.Subject}
	}
	ref, err := h.service.Authorize(r.Context(), subject, expected, spec)
	if err != nil {
		return err
	}
	httputil.Respond(w, status, sharedChargerRefDTO(ref))
	return nil
}

type sharedChargerConfirmationRequest struct {
	AvailableAt        time.Time `json:"available_at"`
	DepartureAt        time.Time `json:"departure_at"`
	EnergyNeededWh     *float64  `json:"energy_needed_wh"`
	ConservativePowerW *float64  `json:"conservative_power_w"`
	AlreadyPlugged     *bool     `json:"already_plugged"`
	AcceptReminder     bool      `json:"accept_reminder"`
}

func (h *SharedChargerHandler) confirm(w http.ResponseWriter, r *http.Request, subject string) error {
	ref, err := sharedChargerRefFromRequest(r)
	vehicleID, vehicleErr := positiveID(chi.URLParam(r, "vehicleID"))
	if err != nil || vehicleErr != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	data, err := decodeSharedPlanning[sharedChargerConfirmationRequest](w, r)
	if err != nil || data.EnergyNeededWh == nil || data.ConservativePowerW == nil || data.AlreadyPlugged == nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	if err := h.service.Confirm(r.Context(), subject, ref, vehicleID, smartreadinesssvc.SharedChargerConfirmationInput{
		AvailableAt: data.AvailableAt, DepartureAt: data.DepartureAt, EnergyNeededWh: *data.EnergyNeededWh,
		ConservativePowerW: *data.ConservativePowerW, AlreadyPlugged: data.AlreadyPlugged, AcceptReminder: data.AcceptReminder,
	}); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *SharedChargerHandler) withdraw(w http.ResponseWriter, r *http.Request, subject string) error {
	ref, err := sharedChargerRefFromRequest(r)
	vehicleID, vehicleErr := positiveID(chi.URLParam(r, "vehicleID"))
	if err != nil || vehicleErr != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	if err := h.service.Withdraw(r.Context(), subject, ref, vehicleID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *SharedChargerHandler) revoke(w http.ResponseWriter, r *http.Request, subject string) error {
	ref, err := sharedChargerRefFromRequest(r)
	if err != nil {
		return err
	}
	if err := h.service.Revoke(r.Context(), subject, ref); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type sharedChargerSlotResponse struct {
	VehicleID int64     `json:"vehicle_id"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
}

type sharedChargerCardResponse struct {
	sharedChargerOwnerResponse
	First       sharedChargerSlotResponse `json:"first"`
	Second      sharedChargerSlotResponse `json:"second"`
	SwapAt      time.Time                 `json:"swap_at"`
	EvaluatedAt time.Time                 `json:"evaluated_at"`
}

type sharedChargerReminderResponse struct {
	sharedChargerRefResponse
	VehicleID int64     `json:"vehicle_id"`
	SwapAt    time.Time `json:"swap_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type sharedChargerViewResponse struct {
	Card     *sharedChargerCardResponse     `json:"card"`
	Reminder *sharedChargerReminderResponse `json:"reminder"`
}

func (h *SharedChargerHandler) card(w http.ResponseWriter, r *http.Request, subject string) error {
	ref, err := sharedChargerRefFromRequest(r)
	if err != nil {
		return err
	}
	result, err := h.service.Card(r.Context(), subject, ref)
	if err != nil {
		return err
	}
	var response sharedChargerViewResponse
	if result != nil {
		response.Card = &sharedChargerCardResponse{
			sharedChargerOwnerResponse: sharedChargerOwnerResponse{
				sharedChargerRefResponse: sharedChargerRefDTO(result.Ref), PlaceID: result.PlaceID, ExpiresAt: result.ExpiresAt,
			},
			First: sharedChargerSlotResponse(result.Schedule.First), Second: sharedChargerSlotResponse(result.Schedule.Second),
			SwapAt: result.Schedule.SwapAt, EvaluatedAt: result.EvaluatedAt,
		}
		reminder, err := h.service.Reminder(r.Context(), subject, ref)
		if err != nil {
			return err
		}
		if reminder != nil {
			response.Reminder = &sharedChargerReminderResponse{
				sharedChargerRefResponse: sharedChargerRefDTO(reminder.Ref), VehicleID: reminder.VehicleID,
				SwapAt: reminder.SwapAt, ExpiresAt: reminder.ExpiresAt,
			}
		}
	}
	httputil.Respond(w, http.StatusOK, response)
	return nil
}

func sharedChargerRefFromRequest(r *http.Request) (domain.SharedChargerRef, error) {
	id, err := positiveID(chi.URLParam(r, "planID"))
	revisions := r.URL.Query()["revision"]
	if err != nil || len(revisions) != 1 {
		return domain.SharedChargerRef{}, smartreadinesssvc.ErrInvalidInput
	}
	revision, err := positiveID(revisions[0])
	return domain.SharedChargerRef{ID: id, Revision: revision}, err
}

func writeSharedChargerError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid shared charger planning request")
	case errors.Is(err, smartreadinesssvc.ErrSharedChargerOperatorRequired):
		httputil.RespondError(w, http.StatusForbidden, "SHARED_CHARGER_OPERATOR_REQUIRED", "trusted operator authorization is required")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "shared charger plan or revision is unavailable")
	case errors.Is(err, port.ErrSharedChargerAlreadyConfirmed):
		httputil.RespondError(w, http.StatusConflict, "ALREADY_CONFIRMED", "this vehicle already confirmed this revision")
	case errors.Is(err, port.ErrSharedChargerActivePlan):
		httputil.RespondError(w, http.StatusConflict, "SHARED_CHARGER_ACTIVE_PLAN", "this reviewed charger already has an active plan")
	case errors.Is(err, port.ErrSharedChargerSwapPublished):
		httputil.RespondError(w, http.StatusConflict, "SWAP_ALREADY_PUBLISHED", "this plan already published its swap reminder")
	default:
		span.RecordError(errors.New("shared charger planning request failed"))
		span.SetStatus(codes.Error, "shared charger planning request failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("shared charger planning request failed")
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "shared charger planning request failed")
	}
}
