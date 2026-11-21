package smartmedia

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

type Handler struct {
	reviews        *smartmediasvc.Reviews
	soundtracks    *smartmediasvc.Soundtracks
	trackReviews   *smartmediasvc.TrackReviews
	episodeReviews *smartmediasvc.EpisodeReviews
	headerName     string
}

func NewHandler(reviews *smartmediasvc.Reviews, soundtracks *smartmediasvc.Soundtracks, trackReviews *smartmediasvc.TrackReviews,
	episodeReviews *smartmediasvc.EpisodeReviews, headerName string) *Handler {
	return &Handler{reviews: reviews, soundtracks: soundtracks, trackReviews: trackReviews, episodeReviews: episodeReviews, headerName: headerName}
}

func (h *Handler) MountRoutes(r chi.Router) {
	edit := httprate.LimitByIP(20, time.Minute)
	connector := httprate.LimitByIP(10, time.Minute)
	if h.reviews != nil {
		r.Get("/media/playlist-review", h.review)
		r.With(edit).Put("/media/playlist-review", h.review)
		r.With(edit).Patch("/media/playlist-review", h.review)
		r.With(edit).Delete("/media/playlist-review", h.review)
		r.With(connector).Post("/media/playlist-review/save", h.save)
		r.With(connector).Post("/media/spotify/connection", h.spotifyConnection)
		r.With(connector).Delete("/media/spotify/connection", h.spotifyConnection)
	}
	if h.soundtracks != nil {
		r.Get("/media/journey-soundtrack/{journeyID}", h.soundtrack)
		r.With(edit).Put("/media/journey-soundtrack/{journeyID}", h.soundtrack)
		r.With(edit).Patch("/media/journey-soundtrack/{journeyID}", h.soundtrack)
		r.With(edit).Delete("/media/journey-soundtrack/{journeyID}", h.soundtrack)
	}
	if h.trackReviews != nil {
		r.Get("/media/drive-track/{driveID}", h.driveTrack)
		r.With(edit).Put("/media/drive-track/{driveID}", h.driveTrack)
		r.With(edit).Delete("/media/drive-track/{driveID}", h.driveTrack)
		r.With(connector).Post("/media/drive-track/{driveID}/spotify", h.trackLibrary)
		r.With(connector).Delete("/media/drive-track/{driveID}/spotify", h.trackLibrary)
		r.With(connector).Post("/media/drive-track/{driveID}/spotify/save", h.saveTrack)
	}
	if h.episodeReviews != nil {
		r.Get("/media/episode-review", h.episodeReview)
		r.With(edit).Put("/media/episode-review", h.episodeReview)
		r.With(edit).Delete("/media/episode-review", h.episodeReview)
	}
	if h.reviews != nil || h.trackReviews != nil || h.episodeReviews != nil {
		r.With(connector).Get("/media/spotify/callback", h.spotifyCallback)
	}
}

func (h *Handler) subject(w http.ResponseWriter, r *http.Request) (string, bool) {
	return privateMediaSubject(w, r, h.headerName)
}

func privateMediaSubject(w http.ResponseWriter, r *http.Request, header string) (string, bool) {
	subject, ok := personal.Subject(w, r, header, "media review")
	if !ok {
		return "", false
	}
	if subject == personaldomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "private media reviews require verified sign-in")
		return "", false
	}
	return subject, true
}

func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (port.Scope, bool) {
	return privateMediaScope(w, r, h.headerName)
}

func privateMediaScope(w http.ResponseWriter, r *http.Request, header string) (port.Scope, bool) {
	subject, ok := privateMediaSubject(w, r, header)
	if !ok {
		return port.Scope{}, false
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || id < 1 {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "select an active vehicle")
		return port.Scope{}, false
	}
	return port.Scope{Subject: subject, VehicleID: id}, true
}

func (h *Handler) review(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.playlist_review")
	defer span.End()
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	var err error
	outcome := ""
	switch r.Method {
	case http.MethodGet:
		review, readErr := h.reviews.Read(ctx, scope)
		if readErr != nil {
			respondError(w, span, readErr)
			return
		}
		httputil.Respond(w, http.StatusOK, review)
		return
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		body, decodeErr := httputil.DecodeAndValidate[struct {
			domain.PlaylistSetup
			ExpectedID *int64 `json:"expected_draft_id"`
		}](r)
		if decodeErr != nil || body.ExpectedID == nil {
			respondError(w, span, smartmediasvc.ErrInvalidInput)
			return
		}
		err = h.reviews.Preview(ctx, scope, *body.ExpectedID, body.PlaylistSetup)
		outcome = "previewed"
	case http.MethodPatch, http.MethodDelete:
		id, parseErr := strconv.ParseInt(r.URL.Query().Get("draft_id"), 10, 64)
		if parseErr != nil || id < 1 {
			respondError(w, span, smartmediasvc.ErrInvalidInput)
			return
		}
		if r.Method == http.MethodDelete {
			err, outcome = h.reviews.Clear(ctx, scope, id), "cleared"
			break
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		body, decodeErr := httputil.DecodeAndValidate[struct {
			Action string `json:"action"`
		}](r)
		if decodeErr != nil || (body.Action != "pause" && body.Action != "snooze") {
			respondError(w, span, smartmediasvc.ErrInvalidInput)
			return
		}
		err = h.reviews.Hold(ctx, scope, id, body.Action == "snooze")
		outcome = body.Action
	}
	if err != nil {
		respondError(w, span, err)
		return
	}
	metrics.RecordPrivatePlaylist(outcome)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.playlist_save")
	defer span.End()
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("draft_id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(w, span, smartmediasvc.ErrInvalidInput)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	body, err := httputil.DecodeAndValidate[domain.SavePlaylist](r)
	if err != nil {
		respondError(w, span, smartmediasvc.ErrInvalidInput)
		return
	}
	status, err := h.reviews.Save(ctx, scope, id, body)
	if err != nil {
		respondError(w, span, err)
		return
	}
	metrics.RecordPrivatePlaylist(string(status))
	httputil.Respond(w, http.StatusOK, map[string]domain.PlaylistSaveStatus{"status": status})
}

func (h *Handler) spotifyConnection(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.spotify_connection")
	defer span.End()
	if r.Method == http.MethodDelete {
		subject, ok := h.subject(w, r)
		if !ok {
			return
		}
		if err := h.reviews.DisconnectSpotify(ctx, subject); err != nil {
			respondError(w, span, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	scope, ok := h.scope(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	body, err := httputil.DecodeAndValidate[struct {
		Confirmed bool `json:"confirmed"`
	}](r)
	if err != nil || !body.Confirmed {
		respondError(w, span, smartmediasvc.ErrInvalidInput)
		return
	}
	authorize, err := h.reviews.StartSpotify(ctx, scope)
	if err != nil {
		respondError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]string{"authorization_url": authorize})
}

func (h *Handler) spotifyCallback(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.spotify_callback")
	defer span.End()
	w.Header().Set("Referrer-Policy", "no-referrer")
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	params := r.URL.Query()
	code := ""
	if params.Get("error") == "" && len(params["code"]) == 1 {
		code = params.Get("code")
	}
	if h.trackReviews != nil && len(params["state"]) == 1 && strings.HasPrefix(params.Get("state"), smartmediasvc.LibraryStatePrefix) {
		scope, err := h.trackReviews.CompleteLibrary(ctx, subject, params.Get("state"), code)
		target, outcome := "/drives", "not-connected"
		if err == nil {
			outcome = "connected"
		}
		if scope.DriveID > 0 {
			target += "/" + strconv.FormatInt(scope.DriveID, 10)
		}
		http.Redirect(w, r, target+"?spotify_library="+outcome+"#drive-track-review", http.StatusSeeOther)
		return
	}
	if h.episodeReviews != nil && len(params["state"]) == 1 && strings.HasPrefix(params.Get("state"), smartmediasvc.EpisodeStatePrefix) {
		vehicleID, err := h.episodeReviews.Complete(ctx, subject, params.Get("state"), code)
		target := "/media-player?spotify_episode=not-reviewed"
		outcome := "progress_not_received"
		if err == nil {
			target = "/media-player?spotify_episode=reviewed"
			outcome = "progress_received"
		}
		metrics.RecordEpisodeReview(outcome)
		if vehicleID > 0 {
			target += "&vehicle_id=" + strconv.FormatInt(vehicleID, 10)
		}
		http.Redirect(w, r, target+"#episode-review", http.StatusSeeOther)
		return
	}
	outcome := "not-connected"
	var vehicleID int64
	if h.reviews != nil && len(params["state"]) == 1 {
		var err error
		vehicleID, err = h.reviews.CompleteSpotify(ctx, subject, params.Get("state"), code)
		if err == nil {
			outcome = "connected"
		}
	}
	target := "/media-player?spotify=" + outcome
	if vehicleID > 0 {
		target += "&vehicle_id=" + strconv.FormatInt(vehicleID, 10)
	}
	http.Redirect(w, r, target+"#playlist-review", http.StatusSeeOther)
}

func respondError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartmediasvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid private playlist request")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle not found")
	case errors.Is(err, port.ErrChanged):
		httputil.RespondError(w, http.StatusConflict, "PLAYLIST_REVIEW_CHANGED", "reopen the current playlist review before continuing")
	case errors.Is(err, smartmediasvc.ErrUnavailable):
		httputil.RespondError(w, http.StatusServiceUnavailable, "SPOTIFY_UNAVAILABLE", "private Spotify playlist authorization is unavailable")
	case errors.Is(err, smartmediasvc.ErrConnect):
		httputil.RespondError(w, http.StatusConflict, "SPOTIFY_CONNECT", "connect your Spotify account before saving")
	case errors.Is(err, smartmediasvc.ErrTrackMatch):
		metrics.RecordPrivatePlaylist("track_unverified")
		httputil.RespondError(w, http.StatusUnprocessableEntity, "SPOTIFY_TRACK_UNVERIFIED", "check the selected Spotify track links and account")
	default:
		span.SetStatus(codes.Error, "private media operation failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("private media operation failed")
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "private media operation failed")
	}
}
