package apicalllog

import (
	"context"
	"errors"
	"net/http"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/rs/zerolog/log"
)

// apiCallLogRepository is the minimal repo surface Handler depends on. It is
// declared as an interface — rather than binding the handler directly to the
// concrete *systemdb.APICallLogRepo — so the handler tests can inject a fake
// without standing up a database. This mirrors the test-double pattern already
// used by internal/api/vampiredrain. The concrete *systemdb.APICallLogRepo
// returned by systemdb.NewAPICallLogRepo satisfies this interface.
type apiCallLogRepository interface {
	GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, service, startDate, endDate, endExclusive string) ([]*teslamodel.APICallLog, int, error)
	GetStats(ctx context.Context, start, endExclusive *time.Time) (map[string]interface{}, error)
}

// Handler handles API call log HTTP requests.
type Handler struct {
	repo apiCallLogRepository
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{
		repo: systemdb.NewAPICallLogRepo(db),
	}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api_logs.list")
	defer span.End()
	limit, offset := apiparams.Pagination(r)

	// url.Values.Get re-parses RawQuery on every call; parse once and reuse.
	q := r.URL.Query()
	method := q.Get("method")
	status := q.Get("status")
	endpoint := q.Get("endpoint")
	service := q.Get("service")
	start := q.Get("start")
	end := q.Get("end")
	endExclusive := q.Get("end_exclusive")
	if endExclusive != "" {
		from, until, err := parseWindow(start, endExclusive)
		if err != nil || end != "" {
			httpx.WriteError(w, http.StatusBadRequest, "start and end_exclusive must be ordered RFC3339 instants without end")
			return
		}
		start = from.Format(time.RFC3339Nano)
		endExclusive = until.Format(time.RFC3339Nano)
	}

	logs, total, err := h.repo.GetAll(ctx, limit, offset, method, status, endpoint, service, start, end, endExclusive)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "api call log list failed")
		log.Ctx(ctx).Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).
			Int("limit", limit).
			Int("offset", offset).
			Str("method", method).
			Str("status", status).
			Str("service", service).
			Msg("failed to list api call logs")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list api call logs")
		return
	}
	if logs == nil {
		logs = []*teslamodel.APICallLog{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"data":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api_logs.stats")
	defer span.End()
	var from, until *time.Time
	q := r.URL.Query()
	if q.Has("start") || q.Has("end_exclusive") {
		start, end, err := parseWindow(q.Get("start"), q.Get("end_exclusive"))
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "start and end_exclusive must be ordered RFC3339 instants")
			return
		}
		from, until = &start, &end
	}
	stats, err := h.repo.GetStats(ctx, from, until)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "api call log stats failed")
		log.Ctx(ctx).Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to get api call log stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get api call log stats")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}

func parseWindow(start, end string) (time.Time, time.Time, error) {
	from, startErr := time.Parse(time.RFC3339Nano, start)
	until, endErr := time.Parse(time.RFC3339Nano, end)
	if startErr != nil || endErr != nil || !from.Before(until) {
		return time.Time{}, time.Time{}, errors.New("invalid API log time window")
	}
	return from, until, nil
}
