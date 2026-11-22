package smartreadiness

import (
	"context"
	"errors"
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type tripReviewService interface {
	Settings(context.Context, domain.StopPlanKey) (domain.TripReviewState, error)
	Save(context.Context, domain.StopPlanKey, domain.TripReviewSetup) error
	SaveAdjustment(context.Context, domain.StopPlanKey, string) error
	Revoke(context.Context, domain.StopPlanKey) error
}

func WithTripReviews(service tripReviewService) Option {
	return func(h *Handler) { h.reviews = service }
}

func (h *Handler) TripReview(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.trip_review")
	defer span.End()
	key, ok := h.privateTripPlan(w, r, span, "trip review")
	if !ok {
		return
	}
	if h.reviews == nil {
		httputil.RespondError(w, http.StatusServiceUnavailable, "TRIP_REVIEW_UNAVAILABLE", "trip review is not available")
		return
	}
	var err error
	switch r.Method {
	case http.MethodGet:
		var state domain.TripReviewState
		state, err = h.reviews.Settings(ctx, key)
		if err == nil {
			httputil.Respond(w, http.StatusOK, state)
		}
	case http.MethodPut:
		type reviewRequest struct {
			domain.TripReviewSetup
			Confirmed         bool     `json:"local_review_confirmed"`
			PlannedArrivalPct *float64 `json:"planned_arrival_pct"`
		}
		input, decodeErr := decode[reviewRequest](w, r)
		if decodeErr != nil || !input.Confirmed || input.PlannedArrivalPct == nil {
			err = smartreadinesssvc.ErrInvalidInput
		} else {
			input.TripReviewSetup.PlannedArrivalPct = *input.PlannedArrivalPct
			err = h.reviews.Save(ctx, key, input.TripReviewSetup)
		}
	case http.MethodPost:
		input, decodeErr := decode[struct {
			AdjustmentKey string `json:"adjustment_key"`
		}](w, r)
		if decodeErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
		} else {
			err = h.reviews.SaveAdjustment(ctx, key, input.AdjustmentKey)
		}
	case http.MethodDelete:
		err = h.reviews.Revoke(ctx, key)
	}
	if err != nil {
		if errors.Is(err, smartreadinesssvc.ErrTripReviewNotActionable) {
			httputil.RespondError(w, http.StatusConflict, "TRIP_REVIEW_NOT_ACTIONABLE", "a completed qualifying trip and current review are required")
			return
		}
		h.handleError(w, span, err)
	} else if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusNoContent)
	}
}
