package automation

import (
	"fmt"
	"net/http"
	"time"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"

	"github.com/rs/zerolog/log"

	dbauto "github.com/ev-dev-labs/teslasync/internal/database/automation"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	"go.opentelemetry.io/otel"
)

// ── History ─────────────────────────────────────────────────────────────

// ListHistory returns paginated execution history across all automations.
//
//	GET /automations/history?limit=50&offset=0&status=failed&since=2026-04-01&until=2026-04-30
func (h *AutomationHandler) ListHistory(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.automation.history_list")
	defer span.End()
	limit, offset := pagination(r)
	f, err := parseHistoryFilter(r)
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	items, total, err := h.historyRepo.ListAll(ctx, f, limit, offset)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to list automation history")
		writeError(w, http.StatusInternalServerError, "failed to list automation history")
		return
	}
	if items == nil {
		items = []*automationmodel.AutomationHistory{}
	}

	stats, err := h.historyRepo.GetStats(ctx, f)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to compute history stats")
		writeError(w, http.StatusInternalServerError, "failed to compute history stats")
		return
	}
	trend, err := h.historyRepo.GetTrend(ctx, f)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to compute history trend")
		writeError(w, http.StatusInternalServerError, "failed to compute history trend")
		return
	}

	writeJSON(w, http.StatusOK, historyListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		Summary: stats,
		Trend:   trend,
	})
}

// ListAutomationHistory returns execution history for a single automation.
//
//	GET /automations/{id}/history?limit=50&offset=0&status=failed&since=2026-04-01&until=2026-04-30
func (h *AutomationHandler) ListAutomationHistory(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.automation.history_by_rule")
	defer span.End()
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		span.RecordError(fmt.Errorf("invalid automation ID"))
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	// Verify automation exists.
	existing, err := h.getByID(ctx, id)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("id", id).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to get automation for history")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	limit, offset := pagination(r)
	f, err := parseHistoryFilter(r)
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	f.AutomationID = id

	items, total, err := h.historyRepo.ListAll(ctx, f, limit, offset)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("automation_id", id).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to list automation history")
		writeError(w, http.StatusInternalServerError, "failed to list automation history")
		return
	}
	if items == nil {
		items = []*automationmodel.AutomationHistory{}
	}

	stats, err := h.historyRepo.GetStats(ctx, f)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("automation_id", id).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to compute history stats")
		writeError(w, http.StatusInternalServerError, "failed to compute history stats")
		return
	}
	trend, err := h.historyRepo.GetTrend(ctx, f)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("automation_id", id).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to compute history trend")
		writeError(w, http.StatusInternalServerError, "failed to compute history trend")
		return
	}

	writeJSON(w, http.StatusOK, historyListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		Summary: stats,
		Trend:   trend,
	})
}

// GetHistoryDetail returns a single execution record with action results and
// FSM transitions that occurred during the execution window.
//
//	GET /automations/history/{historyId}
func (h *AutomationHandler) GetHistoryDetail(w http.ResponseWriter, r *http.Request) {
	historyID, err := urlParamInt64(r, "historyId")
	if err != nil || historyID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid history ID")
		return
	}

	record, err := h.historyRepo.GetByID(r.Context(), historyID)
	if err != nil {
		log.Error().Err(err).Int64("history_id", historyID).Msg("failed to get execution detail")
		writeError(w, http.StatusInternalServerError, "failed to get execution detail")
		return
	}
	if record == nil {
		writeError(w, http.StatusNotFound, "execution record not found")
		return
	}

	// Compute success rate for this automation (unfiltered).
	var successRate float64
	stats, err := h.historyRepo.GetStats(r.Context(), dbauto.HistoryFilter{AutomationID: record.AutomationID})
	if err == nil && stats.TotalExecutions > 0 {
		successRate = stats.SuccessRate
	}

	// Fetch FSM transitions that occurred during the execution window.
	var transitions []dbobs.FSMTransitionRecord
	if record.VehicleID != nil {
		from := record.TriggeredAt
		to := time.Now().UTC()
		if record.CompletedAt != nil {
			to = *record.CompletedAt
		}
		// Cap at 100 transitions; no pagination needed for detail view.
		transitions, _, err = h.fsmTransRepo.Query(r.Context(), *record.VehicleID, "", from, to, 100, 0)
		if err != nil {
			log.Warn().Err(err).Int64("history_id", historyID).Msg("failed to fetch FSM transitions for execution")
			transitions = []dbobs.FSMTransitionRecord{}
		}
	}
	if transitions == nil {
		transitions = []dbobs.FSMTransitionRecord{}
	}

	writeJSON(w, http.StatusOK, historyDetailResponse{
		AutomationHistory: record,
		SuccessRate:       successRate,
		FSMTransitions:    transitions,
	})
}

// parseHistoryFilter accepts an inclusive date-only upper bound, or an exclusive RFC3339 instant.
func parseHistoryFilter(r *http.Request) (dbauto.HistoryFilter, error) {
	f := dbauto.HistoryFilter{
		Status: r.URL.Query().Get("status"),
	}
	if s := r.URL.Query().Get("since"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.Since = t
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			f.Since = t.UTC()
		} else {
			return f, fmt.Errorf("invalid since: expected YYYY-MM-DD or RFC3339")
		}
	}
	if s := r.URL.Query().Get("until"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			f.Before = t.UTC().AddDate(0, 0, 1)
		} else if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.Before = t
		} else {
			return f, fmt.Errorf("invalid until: expected YYYY-MM-DD or RFC3339")
		}
	}
	if !f.Since.IsZero() && !f.Before.IsZero() && !f.Since.Before(f.Before) {
		return f, fmt.Errorf("since must be before until")
	}
	return f, nil
}
