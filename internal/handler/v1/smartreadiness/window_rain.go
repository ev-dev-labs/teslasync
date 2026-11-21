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

type windowRainService interface {
	Read(context.Context, port.WindowRainScope) (*domain.WindowRainPlan, error)
	Enable(context.Context, port.WindowRainScope, int64, domain.WindowRainSetup) error
	Pause(context.Context, port.WindowRainScope, int64) error
	Clear(context.Context, port.WindowRainScope, int64) error
}

func WithWindowRain(service windowRainService, available func() bool) Option {
	return func(h *Handler) { h.windowRain, h.windowRainReady = service, available }
}

func (h *Handler) WindowRain(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "security.window_rain")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private window rain watch")
	if !ok {
		return
	}
	if subject == personalDomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "window rain watch requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.WindowRainScope{Subject: subject, VehicleID: vehicleID}
	available := h.windowRainReady()
	outcome := ""
	switch r.Method {
	case http.MethodGet:
		var plan *domain.WindowRainPlan
		plan, err = h.windowRain.Read(ctx, scope)
		if err == nil {
			if plan != nil && !available {
				plan.Risk = nil
			}
			httputil.Respond(w, http.StatusOK, struct {
				Plan      *domain.WindowRainPlan `json:"plan"`
				Available bool                   `json:"available"`
			}{Plan: plan, Available: available})
			return
		}
	case http.MethodPut:
		body, decodeErr := decode[struct {
			domain.WindowRainSetup
			ExpectedID *int64 `json:"expected_plan_id"`
		}](w, r)
		if decodeErr != nil || body.ExpectedID == nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if !available {
			httputil.RespondError(w, http.StatusServiceUnavailable, "WINDOW_RAIN_UNAVAILABLE", "window rain watch requires distributed telemetry and private browser push")
			return
		}
		err, outcome = h.windowRain.Enable(ctx, scope, *body.ExpectedID, body.WindowRainSetup), "confirmed"
	case http.MethodPatch, http.MethodDelete:
		planID, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if r.Method == http.MethodPatch {
			err, outcome = h.windowRain.Pause(ctx, scope, planID), "paused"
		} else {
			err, outcome = h.windowRain.Clear(ctx, scope, planID), "cleared"
		}
	}
	if errors.Is(err, port.ErrWindowRainChanged) {
		httputil.RespondError(w, http.StatusConflict, "WINDOW_RAIN_CHANGED", "check the current parked vehicle, private browser and watch revision")
	} else if err != nil {
		h.handleError(w, span, err)
	} else {
		metrics.RecordWindowRain(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
