package notification

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// GetReport returns UTC calendar-day aggregates. Only explicitly correlated
// deliveries count as triggers; older rows are counted as deliveries alone.
func (h *Handler) GetReport(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "notifications.report")
	defer span.End()
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	from := today.AddDate(0, 0, -29)
	to := today
	q := r.URL.Query()
	if q.Has("from_instant") || q.Has("to_exclusive") {
		if !q.Has("from_instant") || !q.Has("to_exclusive") || q.Has("from") || q.Has("to") {
			httpx.WriteError(w, http.StatusBadRequest, "from_instant and to_exclusive must be provided together without from/to")
			return
		}
		start, startErr := time.Parse(time.RFC3339Nano, q.Get("from_instant"))
		end, endErr := time.Parse(time.RFC3339Nano, q.Get("to_exclusive"))
		if startErr != nil || endErr != nil || !start.Before(end) || end.Sub(start).Hours() >= 24*18263 {
			httpx.WriteError(w, http.StatusBadRequest, "invalid instant range")
			return
		}
		h.writeReport(w, ctx, span, start, end)
		return
	}
	if value := q.Get("from"); value != "" {
		date, err := time.Parse(time.DateOnly, value)
		if err != nil || date.Format(time.DateOnly) != value {
			httpx.WriteError(w, http.StatusBadRequest, "from must be YYYY-MM-DD")
			return
		}
		from = date
	}
	if value := q.Get("to"); value != "" {
		date, err := time.Parse(time.DateOnly, value)
		if err != nil || date.Format(time.DateOnly) != value {
			httpx.WriteError(w, http.StatusBadRequest, "to must be YYYY-MM-DD")
			return
		}
		to = date
	}
	if to.Before(from) || to.Sub(from).Hours() >= 24*18263 {
		httpx.WriteError(w, http.StatusBadRequest, "date range must be ordered and at most 50 years")
		return
	}
	h.writeReport(w, ctx, span, from, to.AddDate(0, 0, 1))
}

func (h *Handler) writeReport(w http.ResponseWriter, ctx context.Context, span trace.Span, from, until time.Time) {
	result, err := h.report.GetReport(ctx, from, until)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "notification report failed")
		log.Ctx(ctx).Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to get notification report")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get notification report")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}
