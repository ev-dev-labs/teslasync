package api

import (
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ── History ─────────────────────────────────────────────────────────────

// ListHistory returns recent execution history across all automations.
//
//	GET /automations/history?limit=50&offset=0&status=failed&since=2026-04-01
func (h *AutomationHandler) ListHistory(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	f := h.parseHistoryFilter(r)

	items, total, err := h.historyRepo.ListAll(r.Context(), f, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list automation history")
		writeError(w, http.StatusInternalServerError, "failed to list automation history")
		return
	}
	if items == nil {
		items = []*models.AutomationHistory{}
	}

	stats, err := h.historyRepo.GetStats(r.Context(), f)
	if err != nil {
		log.Warn().Err(err).Msg("failed to compute history stats")
		stats = &database.HistoryStats{}
	}

	writeJSON(w, http.StatusOK, historyListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		Summary: stats,
	})
}

// ListAutomationHistory returns execution history for a single automation.
//
//	GET /automations/{id}/history?limit=50&offset=0&status=failed&since=2026-04-01
func (h *AutomationHandler) ListAutomationHistory(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	// Verify automation exists.
	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for history")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	limit, offset := pagination(r)
	f := h.parseHistoryFilter(r)
	f.AutomationID = id

	items, total, err := h.historyRepo.ListAll(r.Context(), f, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("automation_id", id).Msg("failed to list automation history")
		writeError(w, http.StatusInternalServerError, "failed to list automation history")
		return
	}
	if items == nil {
		items = []*models.AutomationHistory{}
	}

	stats, err := h.historyRepo.GetStats(r.Context(), f)
	if err != nil {
		log.Warn().Err(err).Int64("automation_id", id).Msg("failed to compute history stats")
		stats = &database.HistoryStats{}
	}

	writeJSON(w, http.StatusOK, historyListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		Summary: stats,
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
	stats, err := h.historyRepo.GetStats(r.Context(), database.HistoryFilter{AutomationID: record.AutomationID})
	if err == nil && stats.TotalExecutions > 0 {
		successRate = stats.SuccessRate
	}

	// Fetch FSM transitions that occurred during the execution window.
	var transitions []database.FSMTransitionRecord
	if record.VehicleID != nil {
		from := record.TriggeredAt
		to := time.Now().UTC()
		if record.CompletedAt != nil {
			to = *record.CompletedAt
		}
		// Cap at 100 transitions; no pagination needed for detail view.
		transitions, _, err = h.fsmTransRepo.Query(r.Context(), *record.VehicleID, "", nil, from, to, 100, 0)
		if err != nil {
			log.Warn().Err(err).Int64("history_id", historyID).Msg("failed to fetch FSM transitions for execution")
			transitions = []database.FSMTransitionRecord{}
		}
	}
	if transitions == nil {
		transitions = []database.FSMTransitionRecord{}
	}

	writeJSON(w, http.StatusOK, historyDetailResponse{
		AutomationHistory: record,
		SuccessRate:       successRate,
		FSMTransitions:    transitions,
	})
}

// parseHistoryFilter extracts status and since query params into a HistoryFilter.
func (h *AutomationHandler) parseHistoryFilter(r *http.Request) database.HistoryFilter {
	f := database.HistoryFilter{
		Status: r.URL.Query().Get("status"),
	}
	if s := r.URL.Query().Get("since"); s != "" {
		// Try RFC3339 first, then date-only.
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.Since = t
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			f.Since = t.UTC()
		}
	}
	return f
}
