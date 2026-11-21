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

type softwareWindowService interface {
	Read(context.Context, port.SoftwareWindowScope) (*domain.SoftwareWindowPlan, error)
	Available() bool
	Enable(context.Context, port.SoftwareWindowScope, int64, domain.SoftwareWindowSetup) error
	Hold(context.Context, port.SoftwareWindowScope, int64, bool) error
	Clear(context.Context, port.SoftwareWindowScope, int64) error
}

func WithSoftwareWindow(service softwareWindowService) Option {
	return func(h *Handler) { h.softwareWindow = service }
}

func (h *Handler) SoftwareWindow(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "software_updates.window_review")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "software update window review")
	if !ok {
		return
	}
	if subject == personalDomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "software update reviews require verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "select an active vehicle")
		return
	}
	scope := port.SoftwareWindowScope{Subject: subject, VehicleID: vehicleID}
	outcome := ""
	switch r.Method {
	case http.MethodGet:
		var plan *domain.SoftwareWindowPlan
		plan, err = h.softwareWindow.Read(ctx, scope)
		if err == nil {
			if plan != nil {
				metrics.RecordSoftwareWindow(string(plan.Reason))
			}
			httputil.Respond(w, http.StatusOK, struct {
				Plan      *domain.SoftwareWindowPlan `json:"plan"`
				Available bool                       `json:"available"`
			}{Plan: plan, Available: h.softwareWindow.Available()})
			return
		}
	case http.MethodPut:
		body, decodeErr := decode[struct {
			domain.SoftwareWindowSetup
			ExpectedID *int64 `json:"expected_plan_id"`
		}](w, r)
		if decodeErr != nil || body.ExpectedID == nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if !h.softwareWindow.Available() {
			httputil.RespondError(w, http.StatusServiceUnavailable, "SOFTWARE_WINDOW_UNAVAILABLE", "software update reviews require distributed telemetry")
			return
		}
		err, outcome = h.softwareWindow.Enable(ctx, scope, *body.ExpectedID, body.SoftwareWindowSetup), "confirmed"
	case http.MethodPatch, http.MethodDelete:
		id, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if r.Method == http.MethodDelete {
			err, outcome = h.softwareWindow.Clear(ctx, scope, id), "cleared"
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
		err = h.softwareWindow.Hold(ctx, scope, id, body.Action == "snooze")
	}
	switch {
	case errors.Is(err, port.ErrSoftwareWindowChanged):
		httputil.RespondError(w, http.StatusConflict, "SOFTWARE_WINDOW_CHANGED", "check the selected vehicle and current review")
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid software update window settings")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle or software update window settings not found")
	case err != nil:
		h.handleError(w, span, err)
	default:
		metrics.RecordSoftwareWindow(outcome)
		w.WriteHeader(http.StatusNoContent)
	}
}
