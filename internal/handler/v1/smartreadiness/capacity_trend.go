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

type capacityTrendService interface {
	Read(context.Context, port.CapacityTrendScope) (domain.CapacityTrendSettings, error)
	Save(context.Context, port.CapacityTrendScope, int64, string, bool) error
	Disable(context.Context, port.CapacityTrendScope, int64) error
	Dismiss(context.Context, port.CapacityTrendScope, int64, time.Time) error
}

func WithCapacityTrend(service capacityTrendService) Option {
	return func(h *Handler) { h.capacityTrend = service }
}

func (h *Handler) CapacityTrend(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "battery.capacity_digest")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private monthly battery digest")
	if !ok {
		return
	}
	if subject == personaldomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "monthly battery digest requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.CapacityTrendScope{Subject: subject, VehicleID: vehicleID}
	var outcome string
	switch r.Method {
	case http.MethodGet:
		var settings domain.CapacityTrendSettings
		settings, err = h.capacityTrend.Read(ctx, scope)
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
		err = h.capacityTrend.Save(ctx, scope, *body.ExpectedID, body.TimeZone, body.Paused)
		outcome = "confirmed"
		if body.Paused {
			outcome = "paused"
		}
	case http.MethodPatch:
		type dismissal struct {
			PlanID    int64     `json:"plan_id"`
			PeriodEnd time.Time `json:"recent_to"`
		}
		body, decodeErr := decode[dismissal](w, r)
		if decodeErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.capacityTrend.Dismiss(ctx, scope, body.PlanID, body.PeriodEnd)
		outcome = "dismissed"
	case http.MethodDelete:
		var id int64
		id, err = positiveID(r.URL.Query().Get("plan_id"))
		if err != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.capacityTrend.Disable(ctx, scope, id)
		outcome = "cleared"
	}
	if errors.Is(err, port.ErrCapacityTrendChanged) {
		httputil.RespondError(w, http.StatusConflict, "CAPACITY_DIGEST_CHANGED", "refresh the private monthly battery digest before changing it")
	} else if err != nil {
		h.handleError(w, span, err)
	} else if r.Method != http.MethodGet {
		metrics.RecordCapacityDigest(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
