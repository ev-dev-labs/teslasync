package smartmedia

import (
	"errors"
	"net/http"
	"strconv"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

func (h *Handler) episodeReview(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.episode_review")
	defer span.End()
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	var err error
	switch r.Method {
	case http.MethodGet:
		var review *domain.EpisodeReview
		review, err = h.episodeReviews.Read(ctx, scope)
		if err == nil {
			metrics.RecordEpisodeReview(review.Reason)
			httputil.Respond(w, http.StatusOK, review)
			return
		}
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var body domain.EpisodeConfirmation
		body, err = httputil.DecodeAndValidate[domain.EpisodeConfirmation](r)
		if err != nil {
			err = smartmediasvc.ErrInvalidInput
			break
		}
		var target string
		target, err = h.episodeReviews.Confirm(ctx, scope, body)
		if err == nil {
			outcome := "confirmed_manual"
			if target != "" {
				outcome = "authorized_progress_requested"
			}
			metrics.RecordEpisodeReview(outcome)
			httputil.Respond(w, http.StatusOK, map[string]string{"authorization_url": target})
			return
		}
	case http.MethodDelete:
		id, _ := strconv.ParseInt(r.URL.Query().Get("review_id"), 10, 64)
		err = h.episodeReviews.Clear(ctx, scope, id)
		if err == nil {
			metrics.RecordEpisodeReview("cleared")
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	switch {
	case errors.Is(err, smartmediasvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid private episode review request")
	case errors.Is(err, port.ErrChanged):
		httputil.RespondError(w, http.StatusConflict, "EPISODE_REVIEW_CHANGED", "reopen the current episode review")
	case errors.Is(err, smartmediasvc.ErrUnavailable):
		httputil.RespondError(w, http.StatusServiceUnavailable, "SPOTIFY_EPISODE_UNAVAILABLE", "Spotify episode authorization is unavailable")
	default:
		respondError(w, span, err)
	}
}
