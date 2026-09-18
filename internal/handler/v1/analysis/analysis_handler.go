package analysis

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

func analysisWindow(r *http.Request, now time.Time, defaultWindow, maxWindow time.Duration) (int64, time.Time, time.Time, error) {
	id, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, time.Time{}, time.Time{}, fmt.Errorf("vehicle_id must be positive: %w", domain.ErrValidation)
	}
	from, to, err := httputil.ParseDateRangeValues(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		return 0, from, to, fmt.Errorf("invalid dates: %w", domain.ErrValidation)
	}
	if to.IsZero() {
		to = now
	}
	if from.IsZero() {
		from = to.Add(-defaultWindow)
	}
	if !to.After(from) || to.Sub(from) > maxWindow {
		return 0, from, to, fmt.Errorf("unsupported analysis window: %w", domain.ErrValidation)
	}
	return id, from, to, nil
}

func analysisID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid session ID: %w", domain.ErrValidation)
	}
	return id, nil
}

func respondAnalysis[T any](w http.ResponseWriter, r *http.Request, name string, fn func(context.Context) (T, error)) {
	ctx, span := otel.Tracer("api").Start(r.Context(), name)
	defer span.End()
	value, err := fn(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, name)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg(name)
		middleware.HandleError(w, err)
		return
	}
	// Write the payload at the JSON root. httputil.Respond wraps {data:...};
	// request() does not unwrap, so the physics/science pages would treat
	// the envelope as the ledger and render every panel empty.
	httpx.WriteJSON(w, http.StatusOK, value)
}
