package widgetdesign

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/app/widgetdesignsvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/widgetdesign"
	"github.com/ev-dev-labs/teslasync/internal/handler/dto"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type Handler struct {
	service    *widgetdesignsvc.Service
	headerName string
}

func NewHandler(service *widgetdesignsvc.Service, headerName string) *Handler {
	return &Handler{service: service, headerName: strings.TrimSpace(headerName)}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "widget_design.preference")
	defer span.End()
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Add("Vary", "Authorization")
	w.Header().Add("Vary", "Cookie")
	open := auth.IsOpenMode(h.headerName)
	subject := ""
	if !open {
		w.Header().Add("Vary", h.headerName)
		if _, ok := auth.SubjectFromRequest(r, h.headerName); !ok {
			httputil.RespondError(w, http.StatusUnauthorized, auth.MissingIdentityCode, "missing identity header")
			return
		}
		// The helper verifies presence. Preserve the exact opaque header value:
		// never normalize case, assume email, or accept a scope from the client.
		subject = r.Header.Get(h.headerName)
	}
	scope := domain.Scope(subject, open)
	var id string
	var err error
	switch r.Method {
	case http.MethodGet:
		id, err = h.service.Get(ctx, scope)
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input dto.SetWidgetDesignPreference
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			httputil.RespondError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
			return
		}
		if decoder.Decode(new(interface{})) != io.EOF || !domain.ValidPackID(input.PackID) {
			httputil.RespondError(w, http.StatusBadRequest, "INVALID_PACK", "invalid widget design pack")
			return
		}
		id = input.PackID
		err = h.service.Put(ctx, scope, id)
	default:
		w.Header().Set("Allow", "GET, PUT")
		httputil.RespondError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
		return
	}
	if err != nil {
		// Database errors can embed bind parameters. Do not log the error text
		// or attach it to the span, to avoid disclosing provider identities.
		span.RecordError(widgetPreferenceFailure{})
		span.SetStatus(codes.Error, "preference persistence failed")
		log.Error().Str("trace_id", trace.SpanContextFromContext(ctx).TraceID().String()).
			Msg("widget design preference persistence failed")
		httputil.RespondError(w, http.StatusInternalServerError, "PREFERENCE_FAILED", "widget design preference unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dto.WidgetDesignPreference{PackID: id, Scope: scope})
}

type widgetPreferenceFailure struct{}

func (widgetPreferenceFailure) Error() string { return "widget design preference persistence failed" }
