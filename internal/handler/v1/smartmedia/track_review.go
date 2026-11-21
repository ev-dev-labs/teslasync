package smartmedia

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

func (h *Handler) driveScope(w http.ResponseWriter, r *http.Request) (port.DriveScope, bool) {
	scope, ok := h.scope(w, r)
	if !ok {
		return port.DriveScope{}, false
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "driveID"), 10, 64)
	if err != nil || id <= 0 {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "select a completed drive")
		return port.DriveScope{}, false
	}
	return port.DriveScope{Scope: scope, DriveID: id}, true
}

func (h *Handler) driveTrack(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.drive_track_review")
	defer span.End()
	scope, ok := h.driveScope(w, r)
	if !ok {
		return
	}
	var err error
	var outcome string
	switch r.Method {
	case http.MethodGet:
		review, readErr := h.trackReviews.Read(ctx, scope)
		if readErr != nil {
			trackReviewError(w, span, readErr)
			return
		}
		metrics.RecordDriveTrack(review.Reason)
		httputil.Respond(w, http.StatusOK, review)
		return
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 2048)
		body, decodeErr := httputil.DecodeAndValidate[domain.DriveTrackConfirmation](r)
		if decodeErr != nil {
			trackReviewError(w, span, smartmediasvc.ErrInvalidInput)
			return
		}
		err, outcome = h.trackReviews.Confirm(ctx, scope, body), "confirmed"
	case http.MethodDelete:
		id, _ := strconv.ParseInt(r.URL.Query().Get("review_id"), 10, 64)
		err, outcome = h.trackReviews.Clear(ctx, scope, id), "cleared"
	}
	if err != nil {
		trackReviewError(w, span, err)
		return
	}
	metrics.RecordDriveTrack(outcome)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) trackLibrary(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.track_library_authorization")
	defer span.End()
	scope, ok := h.driveScope(w, r)
	if !ok {
		return
	}
	id, _ := strconv.ParseInt(r.URL.Query().Get("review_id"), 10, 64)
	if r.Method == http.MethodDelete {
		if err := h.trackReviews.DisconnectLibrary(ctx, scope, id); err != nil {
			trackReviewError(w, span, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	body, err := httputil.DecodeAndValidate[struct {
		Confirmed bool `json:"confirmed"`
	}](r)
	if err != nil {
		trackReviewError(w, span, smartmediasvc.ErrInvalidInput)
		return
	}
	target, err := h.trackReviews.StartLibrary(ctx, scope, id, body.Confirmed)
	if err != nil {
		trackReviewError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]string{"authorization_url": target})
}

func (h *Handler) saveTrack(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.drive_track_save")
	defer span.End()
	scope, ok := h.driveScope(w, r)
	if !ok {
		return
	}
	id, _ := strconv.ParseInt(r.URL.Query().Get("review_id"), 10, 64)
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	body, err := httputil.DecodeAndValidate[domain.SaveDriveTrack](r)
	if err != nil {
		trackReviewError(w, span, smartmediasvc.ErrInvalidInput)
		return
	}
	status, err := h.trackReviews.SaveLibrary(ctx, scope, id, body)
	if err != nil {
		trackReviewError(w, span, err)
		return
	}
	metrics.RecordDriveTrack(string(status))
	httputil.Respond(w, http.StatusOK, map[string]domain.TrackSaveStatus{"status": status})
}

func trackReviewError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartmediasvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid private drive-track request")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "drive not found for the selected vehicle")
	case errors.Is(err, port.ErrChanged):
		httputil.RespondError(w, http.StatusConflict, "DRIVE_TRACK_REVIEW_CHANGED", "reopen the current drive-track review")
	case errors.Is(err, smartmediasvc.ErrUnavailable):
		httputil.RespondError(w, http.StatusServiceUnavailable, "SPOTIFY_LIBRARY_UNAVAILABLE", "Spotify library authorization is unavailable")
	case errors.Is(err, smartmediasvc.ErrLibraryConnect):
		httputil.RespondError(w, http.StatusConflict, "SPOTIFY_LIBRARY_CONNECT", "authorize the Spotify library separately for this track")
	case errors.Is(err, smartmediasvc.ErrTrackMatch):
		metrics.RecordDriveTrack("track_unverified")
		httputil.RespondError(w, http.StatusUnprocessableEntity, "SPOTIFY_TRACK_UNVERIFIED", "check the selected Spotify track link")
	default:
		respondError(w, span, err)
	}
}
