package smartreadiness

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type tripStopService interface {
	Settings(context.Context, domain.StopPlanKey) (domain.StopComparisonSettings, error)
	Save(context.Context, domain.StopPlanKey, domain.StopComparisonInput) error
	Compare(context.Context, domain.StopPlanKey) (*domain.StopComparisonResult, error)
	Revoke(context.Context, domain.StopPlanKey) error
}

func WithTripStops(service tripStopService) Option {
	return func(h *Handler) { h.stops = service }
}

func (h *Handler) privateTripPlan(w http.ResponseWriter, r *http.Request, span trace.Span, feature string) (domain.StopPlanKey, bool) {
	subject, ok := personalhandler.Subject(w, r, h.headerName, feature)
	if !ok {
		return domain.StopPlanKey{}, false
	}
	if subject == personal.OpenSubject {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "private trip planning requires a verified identity")
		return domain.StopPlanKey{}, false
	}
	planID, idErr := positiveID(chi.URLParam(r, "planID"))
	vehicleID, vehicleErr := positiveID(r.URL.Query().Get("vehicle_id"))
	if idErr != nil || vehicleErr != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return domain.StopPlanKey{}, false
	}
	return domain.StopPlanKey{Subject: subject, VehicleID: vehicleID, PlanID: planID}, true
}

func (h *Handler) TripStops(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.trip_stops")
	defer span.End()
	key, ok := h.privateTripPlan(w, r, span, "trip stop comparison")
	if !ok {
		return
	}
	if h.stops == nil {
		if r.Method == http.MethodGet {
			httputil.Respond(w, http.StatusOK, domain.StopComparisonSettings{})
		} else {
			httputil.RespondError(w, http.StatusServiceUnavailable, "STOP_ROUTING_UNAVAILABLE", "trip stop routing is not configured")
		}
		return
	}

	var err error
	switch r.Method {
	case http.MethodGet:
		var settings domain.StopComparisonSettings
		settings, err = h.stops.Settings(ctx, key)
		if err == nil {
			httputil.Respond(w, http.StatusOK, settings)
		}
	case http.MethodPut:
		input, decodeErr := decode[stopSetupRequest](w, r)
		setup, valid := input.setup()
		if decodeErr != nil || !valid {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.stops.Save(ctx, key, setup)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodPost:
		var result *domain.StopComparisonResult
		result, err = h.stops.Compare(ctx, key)
		if err == nil {
			httputil.Respond(w, http.StatusOK, result)
		}
	case http.MethodDelete:
		err = h.stops.Revoke(ctx, key)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	}

	switch {
	case err == nil:
	case errors.Is(err, port.ErrStopSetup):
		httputil.RespondError(w, http.StatusConflict, "STOP_SETUP_CHANGED", "recheck the trip, battery reserve and selected places")
	case errors.Is(err, smartreadinesssvc.ErrStopRoutingUnavailable):
		httputil.RespondError(w, http.StatusServiceUnavailable, "STOP_ROUTING_UNAVAILABLE", "trip stop routing is not configured")
	case errors.Is(err, smartreadinesssvc.ErrStopRouteCheck):
		httputil.RespondError(w, http.StatusBadGateway, "STOP_ROUTE_CHECK_FAILED", "routing estimates are currently unavailable")
	case errors.Is(err, smartreadinesssvc.ErrStopCheckDeferred):
		httputil.RespondError(w, http.StatusConflict, "STOP_CHECK_DEFERRED", "a stop comparison was requested recently")
	default:
		h.handleError(w, span, err)
	}
}

type stopSetupRequest struct {
	domain.StopComparisonInput
	ProviderConsent bool `json:"provider_consent"`
	CompatibleStops bool `json:"compatible_stops_confirmed"`
	Stops           []struct {
		domain.StopSetup
		Waits []struct {
			domain.StopWaitObservation
			WaitS *int64 `json:"wait_s"`
		} `json:"waits"`
	} `json:"stops"`
}

func (r stopSetupRequest) setup() (domain.StopComparisonInput, bool) {
	setup := r.StopComparisonInput
	if !r.ProviderConsent || !r.CompatibleStops {
		return setup, false
	}
	for _, entry := range r.Stops {
		stop := entry.StopSetup
		for _, raw := range entry.Waits {
			if raw.WaitS == nil {
				return setup, false
			}
			wait := raw.StopWaitObservation
			wait.WaitS = *raw.WaitS
			stop.Waits = append(stop.Waits, wait)
		}
		setup.Stops = append(setup.Stops, stop)
	}
	return setup, true
}
