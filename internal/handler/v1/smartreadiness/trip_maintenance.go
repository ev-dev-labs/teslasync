package smartreadiness

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type tripMaintenanceService interface {
	Settings(context.Context, domain.StopPlanKey) (domain.TripMaintenanceSettings, error)
	Save(context.Context, domain.StopPlanKey, domain.TripMaintenanceSetup) error
	Revoke(context.Context, domain.StopPlanKey) error
}

func WithTripMaintenance(service tripMaintenanceService) Option {
	return func(h *Handler) { h.maintenance = service }
}

func (h *Handler) TripMaintenance(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.trip_maintenance")
	defer span.End()
	key, ok := h.privateTripPlan(w, r, span, "trip maintenance check")
	if !ok {
		return
	}
	if h.maintenance == nil {
		httputil.RespondError(w, http.StatusServiceUnavailable, "TRIP_MAINTENANCE_UNAVAILABLE", "trip maintenance checks are not configured")
		return
	}
	var err error
	switch r.Method {
	case http.MethodGet:
		var state domain.TripMaintenanceSettings
		state, err = h.maintenance.Settings(ctx, key)
		if err == nil {
			httputil.Respond(w, http.StatusOK, state)
		}
	case http.MethodPut:
		type confirmation struct {
			domain.TripMaintenanceSetup
			Confirmed        bool     `json:"local_analysis_confirmed"`
			ServiceOdometerM *float64 `json:"service_odometer_m"`
		}
		body, decodeErr := decode[confirmation](w, r)
		if decodeErr != nil || !body.Confirmed || body.ServiceOdometerM == nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		body.TripMaintenanceSetup.ServiceOdometerM = *body.ServiceOdometerM
		err = h.maintenance.Save(ctx, key, body.TripMaintenanceSetup)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodDelete:
		err = h.maintenance.Revoke(ctx, key)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if err != nil {
		h.handleError(w, span, err)
	}
}
