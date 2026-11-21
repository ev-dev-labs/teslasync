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
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type overnightDrainService interface {
	Read(context.Context, port.OvernightDrainScope) (domain.OvernightDrainSettings, error)
	Save(context.Context, port.OvernightDrainScope, int64, string, bool) error
	Disable(context.Context, port.OvernightDrainScope, int64) error
	Dismiss(context.Context, port.OvernightDrainScope, int64, time.Time) error
}

func WithOvernightDrain(service overnightDrainService) Option {
	return func(h *Handler) { h.overnightDrain = service }
}

func (h *Handler) OvernightDrain(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "battery.overnight_drain_review")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private overnight drain review")
	if !ok {
		return
	}
	if subject == personaldomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "overnight drain review requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.OvernightDrainScope{Subject: subject, VehicleID: vehicleID}
	switch r.Method {
	case http.MethodGet:
		var settings domain.OvernightDrainSettings
		settings, err = h.overnightDrain.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, settings)
		}
	case http.MethodPut:
		type submission struct {
			ExpectedID *int64 `json:"expected_plan_id"`
			TimeZone   string `json:"time_zone"`
			Paused     bool   `json:"paused"`
			Confirmed  bool   `json:"local_review_confirmed"`
		}
		body, decodeErr := decode[submission](w, r)
		if decodeErr != nil || body.ExpectedID == nil || (!body.Paused && !body.Confirmed) {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.overnightDrain.Save(ctx, scope, *body.ExpectedID, body.TimeZone, body.Paused)
		if err == nil {
			if body.Paused {
				metrics.RecordOvernightDrain("paused", 1)
			} else {
				metrics.RecordOvernightDrain("confirmed", 1)
			}
		}
	case http.MethodPatch:
		type dismissal struct {
			PlanID    int64     `json:"plan_id"`
			MorningAt time.Time `json:"morning_at"`
		}
		body, decodeErr := decode[dismissal](w, r)
		if decodeErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.overnightDrain.Dismiss(ctx, scope, body.PlanID, body.MorningAt)
		if err == nil {
			metrics.RecordOvernightDrain("dismissed", 1)
		}
	case http.MethodDelete:
		var id int64
		id, err = positiveID(r.URL.Query().Get("plan_id"))
		if err == nil {
			err = h.overnightDrain.Disable(ctx, scope, id)
			if err == nil {
				metrics.RecordOvernightDrain("cleared", 1)
			}
		} else {
			err = smartreadinesssvc.ErrInvalidInput
		}
	}
	if errors.Is(err, port.ErrOvernightDrainChanged) {
		httputil.RespondError(w, http.StatusConflict, "OVERNIGHT_DRAIN_CHANGED", "refresh the private overnight review before changing it")
	} else if err != nil {
		h.handleError(w, span, err)
	} else if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusNoContent)
	}
}
