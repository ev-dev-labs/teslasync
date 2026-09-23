package notification

import (
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"

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
	result, err := h.report.GetReport(ctx, from, to.AddDate(0, 0, 1))
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "notification report failed")
		log.Ctx(ctx).Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to get notification report")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get notification report")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}
