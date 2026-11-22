package smartreadiness

import (
	"context"
	"errors"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type climateScheduleService interface {
	Read(context.Context, port.ClimateScheduleScope) (domain.ClimateScheduleSettings, error)
	Enable(context.Context, port.ClimateScheduleScope, int64, int64, time.Time) error
	Disable(context.Context, port.ClimateScheduleScope, int64) error
}

func WithClimateScheduleReviews(service climateScheduleService) Option {
	return func(h *Handler) { h.climateSchedules = service }
}

func (h *Handler) ClimateSchedule(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "climate.scheduled_review")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private scheduled climate review")
	if !ok {
		return
	}
	if subject == personaldomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "scheduled climate review requires verified sign-in")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.ClimateScheduleScope{Subject: subject, VehicleID: vehicleID}
	switch r.Method {
	case http.MethodGet:
		var settings domain.ClimateScheduleSettings
		settings, err = h.climateSchedules.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, settings)
		}
	case http.MethodPut:
		type submission struct {
			ExpectedID   *int64    `json:"expected_plan_id"`
			AutomationID int64     `json:"automation_id"`
			Revision     time.Time `json:"schedule_revision"`
			LocalReview  bool      `json:"local_review_confirmed"`
		}
		body, decodeErr := decode[submission](w, r)
		if decodeErr != nil || body.ExpectedID == nil || !body.LocalReview {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.climateSchedules.Enable(ctx, scope, *body.ExpectedID, body.AutomationID, body.Revision)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodDelete:
		planID, idErr := positiveID(r.URL.Query().Get("plan_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.climateSchedules.Disable(ctx, scope, planID)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if errors.Is(err, port.ErrClimateScheduleChanged) {
		httputil.RespondError(w, http.StatusConflict, "CLIMATE_SCHEDULE_CHANGED", "refresh the private climate review before changing it")
	} else if err != nil {
		h.handleError(w, span, err)
	}
}
