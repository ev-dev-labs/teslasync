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

type cabinPrepService interface {
	Read(context.Context, port.CabinPrepScope) (domain.CabinPrepPlan, error)
	Enable(context.Context, port.CabinPrepScope, int64, domain.CabinPrepSetup) error
	Disable(context.Context, port.CabinPrepScope, int64) error
}

func WithCabinPrep(service cabinPrepService, enabled func() bool) Option {
	return func(h *Handler) { h.cabinPrep, h.cabinEnabled = service, enabled }
}

func (h *Handler) CabinPrep(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "climate.cabin_prep")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private cabin prep")
	if !ok {
		return
	}
	if subject == personalDomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "cabin prep requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.CabinPrepScope{Subject: subject, VehicleID: vehicleID}
	deploymentReady := h.cabinEnabled != nil && h.cabinEnabled()
	switch r.Method {
	case http.MethodGet:
		var plan domain.CabinPrepPlan
		plan, err = h.cabinPrep.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, struct {
				domain.CabinPrepPlan
				SetupAvailable bool `json:"setup_available"`
			}{CabinPrepPlan: plan, SetupAvailable: deploymentReady})
		}
	case http.MethodPut:
		if !deploymentReady {
			httputil.RespondError(w, http.StatusServiceUnavailable, "CABIN_PREP_UNAVAILABLE", "private push and live telemetry are required")
			return
		}
		body, decodeErr := decode[struct {
			domain.CabinPrepSetup
			ExpectedID *int64 `json:"expected_plan_id"`
			Confirmed  bool   `json:"departure_confirmed"`
		}](w, r)
		if decodeErr != nil || body.ExpectedID == nil || !body.Confirmed {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.cabinPrep.Enable(ctx, scope, *body.ExpectedID, body.CabinPrepSetup)
		if err == nil {
			metrics.RecordCabinPrepLifecycle("confirmed", 1)
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodDelete:
		planID, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.cabinPrep.Disable(ctx, scope, planID)
		if err == nil {
			metrics.RecordCabinPrepLifecycle("cleared", 1)
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if errors.Is(err, port.ErrCabinPrepChanged) {
		httputil.RespondError(w, http.StatusConflict, "CABIN_PREP_CHANGED", "refresh the private plan and verify the selected browser")
	} else if err != nil {
		h.handleError(w, span, err)
	}
}
