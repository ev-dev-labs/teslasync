package serviceintelligence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const endpointCacheControl = "private, max-age=300, must-revalidate"

type Handler struct {
	service IntelligenceService
}

func NewServiceIntelligenceHandler(service IntelligenceService) *Handler {
	if service == nil {
		panic("serviceintelligence.NewServiceIntelligenceHandler: service must not be nil")
	}
	return &Handler{service: service}
}

// Mount registers the exact path expected inside the parent's /api/v1 route
// group. Authentication remains owned by the parent route group.
func Mount(r chi.Router, handler *Handler) {
	r.Get("/service-intelligence/vehicles/{vehicleID}", handler.Get)
}

// Get serves GET /api/v1/service-intelligence/vehicles/{vehicleID}?refresh=false.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "service_intelligence.get")
	defer span.End()
	r = r.WithContext(ctx)

	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}
	span.SetAttributes(attribute.Int64("vehicle.id", vehicleID))

	refresh, err := parseRefresh(r.URL.Query().Get("refresh"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "refresh must be true or false")
		return
	}

	response, err := h.service.Get(ctx, vehicleID, refresh)
	if err != nil {
		h.writeServiceError(w, ctx, span, vehicleID, err)
		return
	}

	if refresh {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", endpointCacheControl)
	}
	etag, err := semanticETag(response)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "encode response ETag")
		log.Error().
			Err(err).
			Str("trace_id", traceID(ctx)).
			Int64("vehicle_id", vehicleID).
			Msg("service intelligence: failed to encode response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to encode service intelligence")
		return
	}
	w.Header().Set("ETag", etag)
	if !refresh && strings.TrimSpace(r.Header.Get("If-None-Match")) == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

func (h *Handler) writeServiceError(
	w http.ResponseWriter,
	ctx context.Context,
	span trace.Span,
	vehicleID int64,
	err error,
) {
	if errors.Is(err, ErrVehicleNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	span.RecordError(err)
	span.SetStatus(codes.Error, "service intelligence request failed")
	log.Error().
		Err(err).
		Str("trace_id", traceID(ctx)).
		Int64("vehicle_id", vehicleID).
		Msg("service intelligence: request failed")

	var upstreamErr *nhtsa.UpstreamError
	if errors.As(err, &upstreamErr) {
		if upstreamErr.Kind == nhtsa.ErrorKindTimeout {
			httpx.WriteErrorCode(w, http.StatusGatewayTimeout, "NHTSA safety source timed out", "NHTSA_TIMEOUT")
			return
		}
		httpx.WriteErrorCode(w, http.StatusBadGateway, "NHTSA safety source returned an invalid response", "NHTSA_UPSTREAM_ERROR")
		return
	}
	httpx.WriteError(w, http.StatusInternalServerError, "failed to build service intelligence")
}

func parseRefresh(raw string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, errors.New("invalid refresh value")
	}
}

func semanticETag(value *Response) (string, error) {
	representation := *value
	representation.GeneratedAt = time.Time{}
	representation.Sources = append([]nhtsa.SourceMetadata(nil), value.Sources...)
	for i := range representation.Sources {
		representation.Sources[i].CheckedAt = time.Time{}
	}
	body, err := json.Marshal(&representation)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return `W/"` + hex.EncodeToString(sum[:]) + `"`, nil
}

func traceID(ctx context.Context) string {
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return ""
	}
	return spanContext.TraceID().String()
}
