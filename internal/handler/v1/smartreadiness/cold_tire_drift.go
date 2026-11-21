package smartreadiness

import (
	"context"
	"errors"
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type coldTireService interface {
	Read(context.Context, port.ColdTireScope) (domain.ColdTireReview, error)
	Append(context.Context, port.ColdTireScope, int64, domain.ColdTireReading) (domain.ColdTireDriftReason, bool, error)
	Delete(context.Context, port.ColdTireScope, int64) error
}

func WithColdTireChecks(service coldTireService) Option {
	return func(h *Handler) { h.coldTires = service }
}

func (h *Handler) ColdTireReview(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "tire_pressure.cold_review")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private cold tire review")
	if !ok {
		return
	}
	if subject == personaldomain.OpenSubject {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "cold tire review requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.ColdTireScope{Subject: subject, VehicleID: vehicleID}
	switch r.Method {
	case http.MethodGet:
		var review domain.ColdTireReview
		review, err = h.coldTires.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, review)
		}
	case http.MethodPost:
		type submission struct {
			domain.ColdTireReading
			AmbientC *float64 `json:"ambient_c"`
			SeriesID *int64   `json:"expected_series_id"`
		}
		body, decodeErr := decode[submission](w, r)
		if decodeErr != nil || body.AmbientC == nil || body.SeriesID == nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		body.ColdTireReading.AmbientC = *body.AmbientC
		var reason domain.ColdTireDriftReason
		var published bool
		reason, published, err = h.coldTires.Append(ctx, scope, *body.SeriesID, body.ColdTireReading)
		if err == nil {
			metrics.RecordColdTireCheck(reason, published)
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodDelete:
		seriesID, idErr := positiveID(r.URL.Query().Get("series_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.coldTires.Delete(ctx, scope, seriesID)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if errors.Is(err, port.ErrColdTireSeriesChanged) {
		httputil.RespondError(w, http.StatusConflict, "COLD_TIRE_SERIES_CHANGED", "refresh the private series and record only a later, separate check")
	} else if err != nil {
		h.handleError(w, span, err)
	}
}
