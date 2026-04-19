package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationHandler handles automation CRUD HTTP requests.
type AutomationHandler struct {
	repo         *database.AutomationRepo
	historyRepo  *database.AutomationHistoryRepo
	fsmTransRepo *database.FSMTransitionRepo
}

// NewAutomationHandler creates an AutomationHandler backed by the given database.
func NewAutomationHandler(db *database.DB) *AutomationHandler {
	return &AutomationHandler{
		repo:         database.NewAutomationRepo(db),
		historyRepo:  database.NewAutomationHistoryRepo(db),
		fsmTransRepo: database.NewFSMTransitionRepo(db),
	}
}

// automationResponse wraps an Automation with computed fields.
type automationResponse struct {
	*models.Automation
	NextFireTime *string              `json:"next_fire_time,omitempty"`
	Conflicts    []condition.Conflict `json:"conflicts,omitempty"`
}

// newAutomationResponse builds a response with computed next_fire_time.
func newAutomationResponse(a *models.Automation) automationResponse {
	resp := automationResponse{Automation: a}
	if a.TriggerType == "cron" && a.TriggerConfig != nil {
		var cfg struct {
			CronExpr string `json:"cron_expr"`
			Timezone string `json:"timezone"`
		}
		if json.Unmarshal(a.TriggerConfig, &cfg) == nil && cfg.CronExpr != "" {
			if t := trigger.ComputeNextCronFireTime(cfg.CronExpr, cfg.Timezone); t != nil {
				s := t.Format("2006-01-02T15:04:05Z")
				resp.NextFireTime = &s
			}
		}
	}
	return resp
}

// ── List ────────────────────────────────────────────────────────────────

// List returns all automations. Supports ?enabled=true to filter.
func (h *AutomationHandler) List(w http.ResponseWriter, r *http.Request) {
	enabledOnly := strings.EqualFold(r.URL.Query().Get("enabled"), "true")
	automations, err := h.repo.GetAll(r.Context(), enabledOnly)
	if err != nil {
		log.Error().Err(err).Msg("failed to list automations")
		writeError(w, http.StatusInternalServerError, "failed to list automations")
		return
	}
	if automations == nil {
		automations = []*models.Automation{}
	}

	results := make([]automationResponse, len(automations))
	for i, a := range automations {
		results[i] = newAutomationResponse(a)
	}
	writeJSON(w, http.StatusOK, results)
}

// ── Get ─────────────────────────────────────────────────────────────────

// Get returns a single automation by ID with computed fields.
func (h *AutomationHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	writeJSON(w, http.StatusOK, newAutomationResponse(a))
}

// ── Create ──────────────────────────────────────────────────────────────

// createAutomationRequest is the request body for creating an automation.
type createAutomationRequest struct {
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	VehicleID         *int64          `json:"vehicle_id"`
	Enabled           *bool           `json:"enabled"`
	TriggerType       string          `json:"trigger_type"`
	TriggerConfig     json.RawMessage `json:"trigger_config"`
	Conditions        json.RawMessage `json:"conditions"`
	Actions           json.RawMessage `json:"actions"`
	CooldownMinutes   int             `json:"cooldown_minutes"`
	MaxExecutionsHour int             `json:"max_executions_hour"`
	StopOnFailure     bool            `json:"stop_on_failure"`
	NotifyOnRun       bool            `json:"notify_on_run"`
	NotifyOnFailure   bool            `json:"notify_on_failure"`
	SeasonalStart     *int            `json:"seasonal_start"`
	SeasonalEnd       *int            `json:"seasonal_end"`
	Priority          int             `json:"priority"`
	PresetID          *string         `json:"preset_id"`
	Tags              []string        `json:"tags"`
}

// Create creates a new automation with trigger_config validation and conflict detection.
func (h *AutomationHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createAutomationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields.
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.TriggerType == "" {
		writeError(w, http.StatusBadRequest, "trigger_type is required")
		return
	}

	// Validate trigger_config schema.
	if err := trigger.ValidateTriggerConfig(req.TriggerType, req.TriggerConfig); err != nil {
		writeError(w, http.StatusBadRequest, "invalid trigger_config: "+err.Error())
		return
	}

	// Validate actions are parseable.
	if len(req.Actions) > 0 {
		if _, err := action.ParseActions(req.Actions); err != nil {
			writeError(w, http.StatusBadRequest, "invalid actions: "+err.Error())
			return
		}
	}

	// Enforce webhook token uniqueness.
	if req.TriggerType == "webhook" {
		if err := h.checkWebhookTokenUniqueness(r, req.TriggerConfig, 0); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	a := &models.Automation{
		Name:              strings.TrimSpace(req.Name),
		Description:       req.Description,
		VehicleID:         req.VehicleID,
		Enabled:           enabled,
		TriggerType:       req.TriggerType,
		TriggerConfig:     req.TriggerConfig,
		Conditions:        req.Conditions,
		Actions:           req.Actions,
		CooldownMinutes:   req.CooldownMinutes,
		MaxExecutionsHour: req.MaxExecutionsHour,
		StopOnFailure:     req.StopOnFailure,
		NotifyOnRun:       req.NotifyOnRun,
		NotifyOnFailure:   req.NotifyOnFailure,
		SeasonalStart:     req.SeasonalStart,
		SeasonalEnd:       req.SeasonalEnd,
		Priority:          req.Priority,
		PresetID:          req.PresetID,
		Tags:              req.Tags,
	}

	if err := h.repo.Create(r.Context(), a); err != nil {
		log.Error().Err(err).Str("name", a.Name).Msg("failed to create automation")
		writeError(w, http.StatusInternalServerError, "failed to create automation")
		return
	}

	// Run conflict detection.
	resp := newAutomationResponse(a)
	resp.Conflicts = h.detectConflicts(r, a)

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Str("trigger_type", a.TriggerType).
		Int("conflicts", len(resp.Conflicts)).
		Msg("automation created")

	writeJSON(w, http.StatusCreated, resp)
}

// ── Update ──────────────────────────────────────────────────────────────

// Update replaces an automation's configuration. This is full-replacement PUT.
func (h *AutomationHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for update")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	var req createAutomationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.TriggerType == "" {
		writeError(w, http.StatusBadRequest, "trigger_type is required")
		return
	}
	if err := trigger.ValidateTriggerConfig(req.TriggerType, req.TriggerConfig); err != nil {
		writeError(w, http.StatusBadRequest, "invalid trigger_config: "+err.Error())
		return
	}
	if len(req.Actions) > 0 {
		if _, err := action.ParseActions(req.Actions); err != nil {
			writeError(w, http.StatusBadRequest, "invalid actions: "+err.Error())
			return
		}
	}

	if req.TriggerType == "webhook" {
		if err := h.checkWebhookTokenUniqueness(r, req.TriggerConfig, id); err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
	}

	enabled := existing.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	existing.Name = strings.TrimSpace(req.Name)
	existing.Description = req.Description
	existing.VehicleID = req.VehicleID
	existing.Enabled = enabled
	existing.TriggerType = req.TriggerType
	existing.TriggerConfig = req.TriggerConfig
	existing.Conditions = req.Conditions
	existing.Actions = req.Actions
	existing.CooldownMinutes = req.CooldownMinutes
	existing.MaxExecutionsHour = req.MaxExecutionsHour
	existing.StopOnFailure = req.StopOnFailure
	existing.NotifyOnRun = req.NotifyOnRun
	existing.NotifyOnFailure = req.NotifyOnFailure
	existing.SeasonalStart = req.SeasonalStart
	existing.SeasonalEnd = req.SeasonalEnd
	existing.Priority = req.Priority
	existing.PresetID = req.PresetID
	existing.Tags = req.Tags

	if err := h.repo.Update(r.Context(), existing); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update automation")
		writeError(w, http.StatusInternalServerError, "failed to update automation")
		return
	}

	resp := newAutomationResponse(existing)
	resp.Conflicts = h.detectConflicts(r, existing)

	log.Info().
		Int64("automation_id", existing.ID).
		Str("automation", existing.Name).
		Int("conflicts", len(resp.Conflicts)).
		Msg("automation updated")

	writeJSON(w, http.StatusOK, resp)
}

// ── Delete ──────────────────────────────────────────────────────────────

// Delete removes an automation by ID.
func (h *AutomationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	// Verify existence before deleting.
	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for delete")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if err := h.repo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete automation")
		writeError(w, http.StatusInternalServerError, "failed to delete automation")
		return
	}

	log.Info().
		Int64("automation_id", id).
		Str("automation", existing.Name).
		Msg("automation deleted")

	w.WriteHeader(http.StatusNoContent)
}

// ── Toggle ──────────────────────────────────────────────────────────────

// Toggle enables or disables an automation. Rejects enabling auto-disabled
// automations — use the /re-enable endpoint instead.
func (h *AutomationHandler) Toggle(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch current state to prevent broken toggle on auto-disabled automations.
	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for toggle")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if req.Enabled && existing.AutoDisabled {
		writeError(w, http.StatusConflict,
			"automation was auto-disabled: use PATCH /re-enable to re-enable it")
		return
	}

	if err := h.repo.SetEnabled(r.Context(), id, req.Enabled); err != nil {
		log.Error().Err(err).Int64("id", id).Bool("enabled", req.Enabled).Msg("failed to toggle automation")
		writeError(w, http.StatusInternalServerError, "failed to toggle automation")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":      id,
		"enabled": req.Enabled,
	})
}

// ── ReEnable ────────────────────────────────────────────────────────────

// ReEnable clears the auto-disabled state and re-enables the automation,
// resetting the consecutive failure counter.
func (h *AutomationHandler) ReEnable(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for re-enable")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}
	if !existing.AutoDisabled {
		writeError(w, http.StatusBadRequest, "automation is not auto-disabled")
		return
	}

	if err := h.repo.ReEnable(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to re-enable automation")
		writeError(w, http.StatusInternalServerError, "failed to re-enable automation")
		return
	}

	log.Info().
		Int64("automation_id", id).
		Str("automation", existing.Name).
		Msg("automation re-enabled")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":            id,
		"enabled":       true,
		"auto_disabled": false,
	})
}

// ── History ─────────────────────────────────────────────────────────────

// historyListResponse wraps paginated history items with summary statistics.
type historyListResponse struct {
	Items   []*models.AutomationHistory `json:"items"`
	Total   int                         `json:"total"`
	Limit   int                         `json:"limit"`
	Offset  int                         `json:"offset"`
	Summary *database.HistoryStats      `json:"summary"`
}

// historyDetailResponse wraps a single execution record with FSM transitions.
type historyDetailResponse struct {
	*models.AutomationHistory
	SuccessRate    float64                       `json:"success_rate"`
	FSMTransitions []database.FSMTransitionRecord `json:"fsm_transitions"`
}

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
	existing, err := h.repo.GetByID(r.Context(), id)
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

// ── Helpers ─────────────────────────────────────────────────────────────

// detectConflicts fetches all automations and runs conflict detection
// against the candidate. Returns an empty slice (not nil) if none found.
func (h *AutomationHandler) detectConflicts(r *http.Request, candidate *models.Automation) []condition.Conflict {
	all, err := h.repo.GetAll(r.Context(), false)
	if err != nil {
		log.Warn().Err(err).Msg("conflict detection: failed to fetch automations")
		return []condition.Conflict{}
	}
	conflicts := condition.DetectConflicts(r.Context(), candidate, all)
	if conflicts == nil {
		return []condition.Conflict{}
	}
	return conflicts
}

// checkWebhookTokenUniqueness verifies that no other automation uses the same
// webhook_token. excludeID is the ID to skip (for updates); pass 0 for creates.
func (h *AutomationHandler) checkWebhookTokenUniqueness(r *http.Request, config json.RawMessage, excludeID int64) error {
	var cfg struct {
		WebhookToken string `json:"webhook_token"`
	}
	if err := json.Unmarshal(config, &cfg); err != nil || cfg.WebhookToken == "" {
		return nil // webhook token extraction not possible — skip check
	}

	existing, err := h.repo.GetByWebhookToken(r.Context(), cfg.WebhookToken)
	if err != nil {
		log.Warn().Err(err).Msg("webhook uniqueness check failed")
		return nil // non-blocking: allow save on lookup failure
	}
	if existing != nil && existing.ID != excludeID {
		return errWebhookTokenDuplicate
	}
	return nil
}

var errWebhookTokenDuplicate = &duplicateTokenError{}

type duplicateTokenError struct{}

func (e *duplicateTokenError) Error() string {
	return "webhook_token is already in use by another automation"
}
