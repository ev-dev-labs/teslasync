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

type parkReserveService interface {
	Read(context.Context, port.ParkReserveScope) (*domain.ParkReservePlan, error)
	Enable(context.Context, port.ParkReserveScope, int64, domain.ParkReserveSetup) error
	Disable(context.Context, port.ParkReserveScope, int64) error
}

func WithParkReserve(service parkReserveService, available func() (setup, push bool)) Option {
	return func(h *Handler) { h.parkReserves, h.parkAvailable = service, available }
}

func (h *Handler) ParkReserve(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "charging.park_reserve")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private park reserve")
	if !ok {
		return
	}
	if subject == personalDomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "park reserve requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.ParkReserveScope{Subject: subject, VehicleID: vehicleID}
	setupAvailable, pushAvailable := h.parkAvailable()
	switch r.Method {
	case http.MethodGet:
		var plan *domain.ParkReservePlan
		plan, err = h.parkReserves.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, struct {
				Plan           *domain.ParkReservePlan `json:"plan"`
				SetupAvailable bool                    `json:"setup_available"`
				PushAvailable  bool                    `json:"push_available"`
			}{Plan: plan, SetupAvailable: setupAvailable, PushAvailable: pushAvailable})
		}
	case http.MethodPut:
		body, decodeErr := decode[struct {
			domain.ParkReserveSetup
			ExpectedID    *int64 `json:"expected_plan_id"`
			ParkConfirmed bool   `json:"park_confirmed"`
		}](w, r)
		if decodeErr != nil || body.ExpectedID == nil || !body.ParkConfirmed {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		if !setupAvailable || (body.DeviceID != nil && !pushAvailable) {
			httputil.RespondError(w, http.StatusServiceUnavailable, "PARK_RESERVE_UNAVAILABLE", "park reserve requires distributed telemetry and an available delivery method")
			return
		}
		err = h.parkReserves.Enable(ctx, scope, *body.ExpectedID, body.ParkReserveSetup)
		if err == nil {
			metrics.RecordParkReserve("confirmed", 1)
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodDelete:
		planID, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.parkReserves.Disable(ctx, scope, planID)
		if err == nil {
			metrics.RecordParkReserve("cleared", 1)
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if errors.Is(err, port.ErrParkReserveChanged) {
		httputil.RespondError(w, http.StatusConflict, "PARK_RESERVE_CHANGED", "refresh the private plan and verify the selected browser")
	} else if err != nil {
		h.handleError(w, span, err)
	}
}
