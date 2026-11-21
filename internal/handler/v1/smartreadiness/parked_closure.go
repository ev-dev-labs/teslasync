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

type parkedClosureService interface {
	Read(context.Context, port.ParkedClosureScope) (*domain.ParkedClosurePlan, error)
	Enable(context.Context, port.ParkedClosureScope, int64, domain.ParkedClosureSetup) error
	Hold(context.Context, port.ParkedClosureScope, int64, bool) error
	Clear(context.Context, port.ParkedClosureScope, int64) error
}

func WithParkedClosure(service parkedClosureService, available func() bool) Option {
	return func(h *Handler) { h.parkedClosure, h.parkedClosureReady = service, available }
}

func (h *Handler) ParkedClosure(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "security.parked_closure")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "parked closure reminders")
	if !ok {
		return
	}
	if subject == personalDomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "parked closure reminders require verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "select an active vehicle")
		return
	}
	scope := port.ParkedClosureScope{Subject: subject, VehicleID: vehicleID}
	available := h.parkedClosureReady()
	outcome := ""
	switch r.Method {
	case http.MethodGet:
		var plan *domain.ParkedClosurePlan
		plan, err = h.parkedClosure.Read(ctx, scope)
		if err == nil {
			if plan != nil && !available {
				plan.Risk = nil
			}
			httputil.Respond(w, http.StatusOK, struct {
				Plan      *domain.ParkedClosurePlan `json:"plan"`
				Available bool                      `json:"available"`
			}{Plan: plan, Available: available})
			return
		}
	case http.MethodPut:
		body, decodeErr := decode[struct {
			domain.ParkedClosureSetup
			ExpectedID *int64 `json:"expected_plan_id"`
		}](w, r)
		if decodeErr != nil || body.ExpectedID == nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if !available {
			httputil.RespondError(w, http.StatusServiceUnavailable, "PARKED_CLOSURE_UNAVAILABLE", "parked closure reminders require distributed telemetry and private browser push")
			return
		}
		err, outcome = h.parkedClosure.Enable(ctx, scope, *body.ExpectedID, body.ParkedClosureSetup), "confirmed"
	case http.MethodPatch, http.MethodDelete:
		id, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if r.Method == http.MethodDelete {
			err, outcome = h.parkedClosure.Clear(ctx, scope, id), "cleared"
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
		err = h.parkedClosure.Hold(ctx, scope, id, body.Action == "snooze")
	}
	switch {
	case errors.Is(err, port.ErrParkedClosureChanged):
		httputil.RespondError(w, http.StatusConflict, "PARKED_CLOSURE_CHANGED", "check the selected vehicle, private browser and settings revision")
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid parked closure settings")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle or parked closure settings not found")
	case err != nil:
		h.handleError(w, span, err)
	default:
		metrics.RecordParkedClosure(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
