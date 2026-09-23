package teslausage

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbteslausage "github.com/ev-dev-labs/teslasync/internal/database/teslausage"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

type teslaUsageReader interface {
	Cycles(context.Context, time.Time, int, int) (*models.TeslaUsageResponse, error)
	Series(context.Context, time.Time, time.Time, string, int, int) (*models.TeslaUsageSeriesResponse, error)
}

type TeslaUsageHandler struct{ repo teslaUsageReader }

func NewTeslaUsageHandler(db *database.DB) *TeslaUsageHandler {
	return &TeslaUsageHandler{repo: dbteslausage.NewTeslaUsageRepo(db)}
}

func (h *TeslaUsageHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "tesla.usage")
	defer span.End()
	limit, offset := 12, 0
	var err error
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, err = strconv.Atoi(v)
		if err != nil || limit < 1 || limit > 24 {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be between 1 and 24")
			return
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		offset, err = strconv.Atoi(v)
		if err != nil || offset < 0 || offset > 120 {
			httpx.WriteError(w, http.StatusBadRequest, "offset must be between 0 and 120")
			return
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := h.repo.Cycles(ctx, time.Now().UTC(), limit, offset)
	if err != nil {
		span.RecordError(err)
		log.Ctx(ctx).Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("Tesla usage read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "Tesla usage unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// History exposes actual daily/weekly observations in a bounded half-open UTC interval.
func (h *TeslaUsageHandler) History(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "tesla.usage_history")
	defer span.End()
	q := r.URL.Query()
	start, startErr := time.Parse(time.RFC3339, q.Get("start"))
	end, endErr := time.Parse(time.RFC3339, q.Get("end"))
	if startErr != nil || endErr != nil || !start.Before(end) ||
		end.Sub(start) > 366*24*time.Hour || end.After(time.Now().UTC().Add(24*time.Hour)) {
		httpx.WriteError(w, http.StatusBadRequest, "start and end must be RFC3339 timestamps defining at most 366 days, ending no later than tomorrow")
		return
	}
	bucket := q.Get("bucket")
	if bucket != "day" && bucket != "week" {
		httpx.WriteError(w, http.StatusBadRequest, "bucket must be day or week")
		return
	}
	limit, offset := 366, 0
	var err error
	if q.Has("limit") {
		limit, err = strconv.Atoi(q.Get("limit"))
		if err != nil || limit < 1 || limit > 366 {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be between 1 and 366")
			return
		}
	}
	if q.Has("offset") {
		offset, err = strconv.Atoi(q.Get("offset"))
		if err != nil || offset < 0 || offset > 366 {
			httpx.WriteError(w, http.StatusBadRequest, "offset must be between 0 and 366")
			return
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := h.repo.Series(ctx, start.UTC(), end.UTC(), bucket, limit, offset)
	if err != nil {
		span.RecordError(err)
		log.Ctx(ctx).Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("Tesla usage history read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "Tesla usage history unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}
