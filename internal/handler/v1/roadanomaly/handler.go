package roadanomaly

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/roadanomalysvc"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type roadAnomalyAnalyzer interface {
	Analyze(context.Context, int64) (roadanomalysvc.Result, error)
}

// RoadAnomalyHandler serves unverified drive-scoped road-anomaly candidates.
type RoadAnomalyHandler struct{ analyzer roadAnomalyAnalyzer }

func NewRoadAnomalyHandler(analyzer roadAnomalyAnalyzer) *RoadAnomalyHandler {
	return &RoadAnomalyHandler{analyzer: analyzer}
}

// Get rejects all query parameters: only a bounded, complete drive is read.
func (h *RoadAnomalyHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "drives.road_anomalies")
	defer span.End()
	id, err := strconv.ParseInt(chi.URLParam(r, "driveID"), 10, 64)
	if err != nil || id <= 0 || len(r.URL.Query()) != 0 {
		httputil.RespondError(w, http.StatusBadRequest, "INVALID_PARAMETER", "positive drive ID required; query parameters are not supported")
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	result, err := h.analyzer.Analyze(ctx, id)
	if err != nil {
		switch {
		case errors.Is(err, roadanomalysvc.ErrNotFound):
			httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "drive not found")
		case errors.Is(err, roadanomalysvc.ErrWindowTooLarge):
			httputil.RespondError(w, http.StatusUnprocessableEntity, "WINDOW_TOO_LARGE", "drive exceeds two-hour analysis limit")
		default:
			span.RecordError(err)
			span.SetStatus(codes.Error, "road anomaly analysis failed")
			log.Error().Err(err).Str("trace_id", trace.SpanFromContext(ctx).SpanContext().TraceID().String()).
				Int64("drive_id", id).Msg("road anomaly analysis failed")
			httputil.RespondError(w, http.StatusInternalServerError, "ANALYSIS_FAILED", "road anomaly analysis failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(result); err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", trace.SpanFromContext(ctx).SpanContext().TraceID().String()).
			Int64("drive_id", id).Msg("failed to encode road anomaly response")
	}
}
