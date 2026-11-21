package smartmedia

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

type FavoritesHandler struct {
	digests *smartmediasvc.FavoriteDigests
	header  string
}

func NewFavoritesHandler(digests *smartmediasvc.FavoriteDigests, header string) *FavoritesHandler {
	return &FavoritesHandler{digests: digests, header: header}
}

func (h *FavoritesHandler) MountRoutes(r chi.Router) {
	edit := httprate.LimitByIP(20, time.Minute)
	r.Get("/media/favorite-digest", h.favoriteDigest)
	r.With(edit).Put("/media/favorite-digest", h.favoriteDigest)
	r.With(edit).Post("/media/favorite-digest", h.favoriteDigest)
	r.With(edit).Delete("/media/favorite-digest", h.favoriteDigest)
}

func (h *FavoritesHandler) favoriteDigest(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "media.favorite_digest")
	defer span.End()
	scope, ok := privateMediaScope(w, r, h.header)
	if !ok {
		return
	}
	var err error
	outcome := ""
	switch r.Method {
	case http.MethodGet:
		var review domain.FavoriteDigestSettings
		review, err = h.digests.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, review)
			return
		}
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		setup, decodeErr := httputil.DecodeAndValidate[domain.FavoriteDigestSetup](r)
		if decodeErr != nil {
			err = smartmediasvc.ErrInvalidInput
			break
		}
		err = h.digests.Save(ctx, scope, setup)
		outcome = "enabled"
		if setup.Paused {
			outcome = "paused"
		}
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		action, decodeErr := httputil.DecodeAndValidate[domain.FavoriteDigestAction](r)
		if decodeErr != nil {
			err = smartmediasvc.ErrInvalidInput
			break
		}
		err = h.digests.Act(ctx, scope, action)
		outcome = action.Action
	case http.MethodDelete:
		revision, _ := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
		err = h.digests.Clear(ctx, scope, revision)
		outcome = "cleared"
	}
	switch {
	case err == nil:
		metrics.RecordFavoriteDigest(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, smartmediasvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid private favorite digest request")
	case errors.Is(err, port.ErrChanged):
		httputil.RespondError(w, http.StatusConflict, "FAVORITE_DIGEST_CHANGED", "reopen the current private shortlist")
	case errors.Is(err, port.ErrFavoriteLimit):
		httputil.RespondError(w, http.StatusConflict, "FAVORITE_LIMIT", "remove one of your saved favorites before saving another")
	default:
		respondError(w, span, err)
	}
}
