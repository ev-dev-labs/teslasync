package smartreadiness

import (
	"context"
	"errors"
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	personalDomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type parkedUnlockService interface {
	Read(context.Context, port.ParkedUnlockScope) (*domain.ParkedUnlockPlan, error)
	Enable(context.Context, port.ParkedUnlockScope, int64, domain.ParkedUnlockSetup) error
	Hold(context.Context, port.ParkedUnlockScope, int64, bool) error
	Clear(context.Context, port.ParkedUnlockScope, int64) error
}

func WithParkedUnlock(service parkedUnlockService, available func() bool) Option {
	return func(h *Handler) { h.parkedUnlock, h.parkedUnlockReady = service, available }
}

func (h *Handler) ParkedUnlock(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "security.parked_unlock")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "parked unlock reminders")
	if !ok {
		return
	}
	if subject == personalDomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "parked unlock reminders require verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "select an active vehicle")
		return
	}
	scope := port.ParkedUnlockScope{Subject: subject, VehicleID: vehicleID}
	available := h.parkedUnlockReady()
	outcome := ""
	switch r.Method {
	case http.MethodGet:
		var plan *domain.ParkedUnlockPlan
		plan, err = h.parkedUnlock.Read(ctx, scope)
		if err == nil {
			if plan != nil && !available {
				plan.Risk = nil
			}
			httputil.Respond(w, http.StatusOK, struct {
				Plan      *domain.ParkedUnlockPlan `json:"plan"`
				Available bool                     `json:"available"`
			}{Plan: plan, Available: available})
			return
		}
	case http.MethodPut:
		body, decodeErr := decode[struct {
			domain.ParkedUnlockSetup
			ExpectedID *int64 `json:"expected_plan_id"`
		}](w, r)
		if decodeErr != nil || body.ExpectedID == nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if !available {
			httputil.RespondError(w, http.StatusServiceUnavailable, "PARKED_UNLOCK_UNAVAILABLE", "parked unlock reminders require distributed telemetry and private browser push")
			return
		}
		err, outcome = h.parkedUnlock.Enable(ctx, scope, *body.ExpectedID, body.ParkedUnlockSetup), "confirmed"
	case http.MethodPatch, http.MethodDelete:
		id, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if r.Method == http.MethodDelete {
			err, outcome = h.parkedUnlock.Clear(ctx, scope, id), "cleared"
			break
		}
		body, decodeErr := decode[struct {
			Action string `json:"action"`
		}](w, r)
		if decodeErr != nil || (body.Action != "pause" && body.Action != "snooze") {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		outcome = "paused"
		if body.Action == "snooze" {
			outcome = "snoozed"
		}
		err = h.parkedUnlock.Hold(ctx, scope, id, body.Action == "snooze")
	}
	switch {
	case errors.Is(err, port.ErrParkedUnlockChanged):
		httputil.RespondError(w, http.StatusConflict, "PARKED_UNLOCK_CHANGED", "check the selected place, vehicle, private browser and settings revision")
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid parked unlock settings")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle or parked unlock settings not found")
	case err != nil:
		h.handleError(w, span, err)
	default:
		metrics.RecordParkedUnlock(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
