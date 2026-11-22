package smartfeature

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/smartfeaturesvc"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type Handler struct {
	service    *smartfeaturesvc.Service
	headerName string
}

func NewHandler(service *smartfeaturesvc.Service, headerName string) *Handler {
	return &Handler{service: service, headerName: headerName}
}

func (h *Handler) MountRoutes(r chi.Router) {
	r.Get("/settings/smart-features", h.list)
	r.With(httprate.LimitByIP(30, time.Minute)).Put("/settings/smart-features/{feature}", h.set)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_features.list")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "smart features")
	if !ok {
		return
	}
	prefs, err := h.service.List(ctx, subject)
	if err != nil {
		respondError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, prefs)
}

func (h *Handler) set(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_features.set")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "smart features")
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	body, err := httputil.DecodeAndValidate[struct {
		Allowed *bool `json:"allowed"`
	}](r)
	if err != nil || body.Allowed == nil {
		respondError(w, span, domain.ErrValidation)
		return
	}
	pref := smartfeature.Preference{Feature: smartfeature.Key(chi.URLParam(r, "feature")), Allowed: *body.Allowed}
	if err := h.service.Set(ctx, subject, pref); err != nil {
		respondError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, pref)
}

func respondError(w http.ResponseWriter, span trace.Span, err error) {
	if errors.Is(err, domain.ErrValidation) {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid smart feature preference")
		return
	}
	span.RecordError(err)
	span.SetStatus(codes.Error, "smart feature preference operation failed")
	log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("smart feature preference operation failed")
	httputil.RespondError(w, http.StatusInternalServerError, "SMART_FEATURES_UNAVAILABLE", "smart feature preferences are unavailable")
}
