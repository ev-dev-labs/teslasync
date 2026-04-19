package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationHandler handles automation CRUD HTTP requests.
type AutomationHandler struct {
	repo           *database.AutomationRepo
	historyRepo    *database.AutomationHistoryRepo
	fsmTransRepo   *database.FSMTransitionRepo
	cmdExecutor    *action.CommandExecutor // optional, enables undo
	eventPublisher *AutomationEventPublisher // optional, enables SSE events
}

// AutomationHandlerOption configures optional AutomationHandler dependencies.
type AutomationHandlerOption func(*AutomationHandler)

// WithCommandExecutor provides a CommandExecutor for undo support.
func WithCommandExecutor(e *action.CommandExecutor) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.cmdExecutor = e }
}

// WithAutomationEventPublisher provides an event publisher for SSE automation events.
func WithAutomationEventPublisher(p *AutomationEventPublisher) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.eventPublisher = p }
}

// NewAutomationHandler creates an AutomationHandler backed by the given database.
func NewAutomationHandler(db *database.DB, opts ...AutomationHandlerOption) *AutomationHandler {
	h := &AutomationHandler{
		repo:         database.NewAutomationRepo(db),
		historyRepo:  database.NewAutomationHistoryRepo(db),
		fsmTransRepo: database.NewFSMTransitionRepo(db),
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
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

// ── Test Run ────────────────────────────────────────────────────────────

// testRunResponse is the top-level response for a dry-run test.
type testRunResponse struct {
	AutomationID   int64                `json:"automation_id"`
	AutomationName string               `json:"automation_name"`
	VehicleID      *int64               `json:"vehicle_id"`
	TriggerType    string               `json:"trigger_type"`
	Status         string               `json:"status"` // always "test"
	ConditionsMet  bool                 `json:"conditions_met"`
	Conditions     []testConditionResult `json:"conditions"`
	Actions        []testActionResult   `json:"actions"`
	ExecutionPlan  testExecutionPlan    `json:"execution_plan"`
	HistoryID      int64                `json:"history_id"`
	Timestamp      time.Time            `json:"timestamp"`
}

// testConditionResult captures the evaluation of a single condition during dry-run.
type testConditionResult struct {
	Index    int             `json:"index"`
	Type     string          `json:"type"`
	Result   string          `json:"result"` // "met", "not_met", "unknown"
	Reason   string          `json:"reason"`
	Snapshot json.RawMessage `json:"snapshot,omitempty"`
}

// testActionResult captures the simulated outcome of a single action.
type testActionResult struct {
	Index      int             `json:"index"`
	ActionType string          `json:"action_type"`
	Config     json.RawMessage `json:"action_config"`
	Valid      bool            `json:"valid"`
	Error      string          `json:"error,omitempty"`
	Simulated  bool            `json:"simulated"`
	WouldSkip  bool            `json:"would_skip,omitempty"`
	SkipReason string          `json:"skip_reason,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
}

// testExecutionPlan summarises what the automation would do.
type testExecutionPlan struct {
	TotalActions         int  `json:"total_actions"`
	ValidActions         int  `json:"valid_actions"`
	StopOnFailure        bool `json:"stop_on_failure"`
	ConditionsCount      int  `json:"conditions_count"`
	AllConditionsMet     bool `json:"all_conditions_met"`
	HasUnknownConditions bool `json:"has_unknown_conditions"`
}

// TestRun performs a dry-run of an automation: evaluates the trigger snapshot,
// checks conditions, and resolves the action chain using a mock executor.
// The test run is logged in history with status "test". No real commands
// are sent and no execution counters are updated.
//
//	POST /automations/{id}/test-run
func (h *AutomationHandler) TestRun(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("test-run: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	now := time.Now().UTC()

	// ── Evaluate conditions ───────────────────────────────────────────
	condResults := h.evaluateTestConditions(a, now)

	allMet := true
	hasUnknown := false
	for _, cr := range condResults {
		switch cr.Result {
		case "not_met":
			allMet = false
		case "unknown":
			hasUnknown = true
		}
	}

	// ── Validate & simulate actions ───────────────────────────────────
	actionResults, validCount := h.simulateActions(a, allMet)

	// ── Persist history record with status "test" ─────────────────────
	conditionsJSON, _ := json.Marshal(condResults)
	actionsJSON, _ := json.Marshal(actionResults)
	triggerSnapshot, _ := json.Marshal(map[string]interface{}{
		"type":      "test_run",
		"simulated": true,
	})

	durationMs := int(time.Since(now).Milliseconds())
	completedAt := time.Now().UTC()
	hist := &models.AutomationHistory{
		AutomationID:       a.ID,
		AutomationName:     a.Name,
		VehicleID:          a.VehicleID,
		TriggeredAt:        now,
		CompletedAt:        &completedAt,
		DurationMs:         &durationMs,
		TriggerType:        a.TriggerType,
		TriggerSnapshot:    triggerSnapshot,
		ConditionsMet:      allMet,
		ConditionsSnapshot: conditionsJSON,
		ActionsExecuted:    actionsJSON,
		ActionsTotal:       len(actionResults),
		ActionsSucceeded:   validCount,
		ActionsFailed:      0,
		Status:             "test",
	}

	if err := h.historyRepo.Create(r.Context(), hist); err != nil {
		log.Error().Err(err).Int64("automation_id", a.ID).Msg("test-run: failed to log history")
		writeError(w, http.StatusInternalServerError, "failed to log test run")
		return
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Bool("conditions_met", allMet).
		Int("actions", len(actionResults)).
		Msg("automation test-run completed")

	// Publish SSE events for the test-run
	if h.eventPublisher != nil {
		h.eventPublisher.PublishTriggered(a.ID, a.Name, "", a.TriggerType, "test")
		if !allMet {
			h.eventPublisher.PublishSkipped(a.ID, a.Name, "conditions not met (test-run)", "test")
		} else if validCount == len(actionResults) {
			durationMs := time.Since(now).Milliseconds()
			h.eventPublisher.PublishSucceeded(a.ID, a.Name, durationMs, validCount, "test")
		} else {
			h.eventPublisher.PublishFailed(a.ID, a.Name, "some actions invalid (test-run)", -1, "test")
		}
	}

	writeJSON(w, http.StatusOK, testRunResponse{
		AutomationID:   a.ID,
		AutomationName: a.Name,
		VehicleID:      a.VehicleID,
		TriggerType:    a.TriggerType,
		Status:         "test",
		ConditionsMet:  allMet,
		Conditions:     condResults,
		Actions:        actionResults,
		ExecutionPlan: testExecutionPlan{
			TotalActions:         len(actionResults),
			ValidActions:         validCount,
			StopOnFailure:        a.StopOnFailure,
			ConditionsCount:      len(condResults),
			AllConditionsMet:     allMet,
			HasUnknownConditions: hasUnknown,
		},
		HistoryID: hist.ID,
		Timestamp: now,
	})
}

// evaluateTestConditions parses and evaluates each condition in the
// automation. Time-based conditions use real time; state-dependent
// conditions that require unavailable context are reported as "unknown".
func (h *AutomationHandler) evaluateTestConditions(a *models.Automation, now time.Time) []testConditionResult {
	if len(a.Conditions) == 0 || string(a.Conditions) == "[]" || string(a.Conditions) == "null" {
		return []testConditionResult{}
	}

	var rawConditions []json.RawMessage
	if err := json.Unmarshal(a.Conditions, &rawConditions); err != nil {
		return []testConditionResult{{
			Index:  0,
			Type:   "parse_error",
			Result: "unknown",
			Reason: "failed to parse conditions array: " + err.Error(),
		}}
	}

	results := make([]testConditionResult, 0, len(rawConditions))

	for i, raw := range rawConditions {
		var peek struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &peek); err != nil {
			results = append(results, testConditionResult{
				Index:  i,
				Type:   "unknown",
				Result: "unknown",
				Reason: "failed to parse condition: " + err.Error(),
			})
			continue
		}

		cr := h.evaluateSingleCondition(i, peek.Type, raw, a, now)
		results = append(results, cr)
	}

	return results
}

// evaluateSingleCondition evaluates one condition, dispatching to the
// appropriate typed evaluator.
func (h *AutomationHandler) evaluateSingleCondition(
	index int, condType string, raw json.RawMessage,
	a *models.Automation, now time.Time,
) testConditionResult {
	base := testConditionResult{Index: index, Type: condType}

	switch condType {
	case "time_window":
		cfg, err := condition.ParseTimeWindowConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateTimeWindow(cfg, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "day_filter":
		cfg, err := condition.ParseDayFilterConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateDayFilter(cfg, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "seasonal":
		cfg, err := condition.ParseSeasonalConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateSeasonal(cfg, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "cooldown":
		cfg, err := condition.ParseCooldownConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateCooldown(cfg, a.LastTriggeredAt, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "state_check":
		if _, err := condition.ParseStateCheckConfig(raw); err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		return withUnknown(base, "requires live vehicle state (not available in test-run)")

	case "location":
		if _, err := condition.ParseLocationConfig(raw); err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		return withUnknown(base, "requires live vehicle position and geofence data (not available in test-run)")

	case "variable_check":
		if _, err := condition.ParseVariableCheckConfig(raw); err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		return withUnknown(base, "requires automation variable store (not available in test-run)")

	default:
		return withUnknown(base, "unknown condition type: "+condType)
	}
}

// withResult builds a testConditionResult from a condition.Result.
func withResult(base testConditionResult, res condition.Result, snapshot json.RawMessage) testConditionResult {
	base.Snapshot = snapshot
	base.Reason = res.Reason
	if res.Met {
		base.Result = "met"
	} else {
		base.Result = "not_met"
	}
	return base
}

// withUnknown builds a testConditionResult that could not be evaluated.
func withUnknown(base testConditionResult, reason string) testConditionResult {
	base.Result = "unknown"
	base.Reason = reason
	return base
}

// simulateActions parses the automation's action chain, validates each
// action config, and returns simulated results. Returns the results and
// the count of valid actions.
func (h *AutomationHandler) simulateActions(a *models.Automation, conditionsMet bool) ([]testActionResult, int) {
	if len(a.Actions) == 0 || string(a.Actions) == "[]" || string(a.Actions) == "null" {
		return []testActionResult{}, 0
	}

	configs, err := action.ParseActions(a.Actions)
	if err != nil {
		return []testActionResult{{
			Index:      0,
			ActionType: "parse_error",
			Simulated:  true,
			Error:      "failed to parse actions: " + err.Error(),
		}}, 0
	}

	simulatedOutput, _ := json.Marshal(map[string]interface{}{
		"success":   true,
		"simulated": true,
	})

	results := make([]testActionResult, 0, len(configs))
	validCount := 0
	stopped := false

	for i, cfg := range configs {
		result := testActionResult{
			Index:      i,
			ActionType: cfg.Type,
			Config:     cfg.Raw,
			Simulated:  true,
		}

		// If conditions not met, all actions would be skipped.
		if !conditionsMet {
			result.WouldSkip = true
			result.SkipReason = "conditions not met"
			results = append(results, result)
			continue
		}

		// If a previous action was invalid and stop_on_failure is set.
		if stopped {
			result.WouldSkip = true
			result.SkipReason = "previous action invalid (stop_on_failure)"
			results = append(results, result)
			continue
		}

		// Validate per-type config.
		if parseErr := validateActionConfig(cfg); parseErr != nil {
			result.Error = parseErr.Error()
			if a.StopOnFailure {
				stopped = true
			}
		} else {
			result.Valid = true
			result.Output = simulatedOutput
			validCount++
		}

		results = append(results, result)
	}

	return results, validCount
}

// validateActionConfig runs the per-type parser for deeper config validation.
func validateActionConfig(cfg action.ActionConfig) error {
	switch cfg.Type {
	case "command":
		_, err := action.ParseCommandConfig(cfg.Raw)
		return err
	case "notify":
		_, err := action.ParseNotifyConfig(cfg.Raw)
		return err
	case "wait":
		_, err := action.ParseWaitConfig(cfg.Raw)
		return err
	case "set_variable":
		_, err := action.ParseSetVariableConfig(cfg.Raw)
		return err
	default:
		return nil
	}
}

var errWebhookTokenDuplicate = &duplicateTokenError{}

type duplicateTokenError struct{}

func (e *duplicateTokenError) Error() string {
	return "webhook_token is already in use by another automation"
}

// ── Undo Last ───────────────────────────────────────────────────────────

// reverseCommands maps Tesla commands to their logical inverse.
// Commands not in this map are considered irreversible.
var reverseCommands = map[string]string{
	"lock":        "unlock",
	"unlock":      "lock",
	"climate_on":  "climate_off",
	"climate_off": "climate_on",
	"sentry_on":   "sentry_off",
	"sentry_off":  "sentry_on",
	"charge_start": "charge_stop",
	"charge_stop":  "charge_start",
	"vent_windows":  "close_windows",
	"close_windows": "vent_windows",
	"valet_on":     "valet_off",
	"valet_off":    "valet_on",
	"guest_mode_on":  "guest_mode_off",
	"guest_mode_off": "guest_mode_on",
	"cop_on":   "cop_off",
	"cop_off":  "cop_on",
	"bioweapon_on":  "bioweapon_off",
	"bioweapon_off": "bioweapon_on",
	"speed_limit_on":  "speed_limit_off",
	"speed_limit_off": "speed_limit_on",
	"sunroof_vent":  "sunroof_close",
	"sunroof_close": "sunroof_vent",
	"climate_keeper_on":  "climate_keeper_off",
	"climate_keeper_off": "climate_keeper_on",
	"dog_mode":  "climate_keeper_off",
	"camp_mode": "climate_keeper_off",
}

// undoResponse is the top-level response for the undo endpoint.
type undoResponse struct {
	AutomationID      int64              `json:"automation_id"`
	AutomationName    string             `json:"automation_name"`
	OriginalHistoryID int64              `json:"original_history_id"`
	UndoHistoryID     int64              `json:"undo_history_id"`
	Actions           []undoActionResult `json:"actions"`
	Reversed          int                `json:"reversed"`
	Skipped           int                `json:"skipped"`
	Failed            int                `json:"failed"`
	Status            string             `json:"status"`
	Timestamp         time.Time          `json:"timestamp"`
}

// undoActionResult captures the outcome of reversing a single command.
type undoActionResult struct {
	OriginalCommand string `json:"original_command"`
	ReverseCommand  string `json:"reverse_command,omitempty"`
	Status          string `json:"status"` // "reversed", "skipped", "failed", "irreversible"
	Error           string `json:"error,omitempty"`
	DurationMs      int64  `json:"duration_ms,omitempty"`
}

// UndoLast reverses the most recent successful or partial execution of an
// automation by sending the inverse of each reversible command action.
// Commands without a known reverse (honk, flash, navigate, etc.) are
// skipped and noted in the response. The undo is logged as a separate
// history entry with status "undo".
//
//	POST /automations/{id}/undo
func (h *AutomationHandler) UndoLast(w http.ResponseWriter, r *http.Request) {
	if h.cmdExecutor == nil {
		writeError(w, http.StatusNotImplemented, "undo requires command execution capability (not configured)")
		return
	}

	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("undo: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	// Find the most recent successful or partial execution.
	lastExec, err := h.historyRepo.GetLatestSuccessful(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("automation_id", id).Msg("undo: failed to fetch latest execution")
		writeError(w, http.StatusInternalServerError, "failed to fetch execution history")
		return
	}
	if lastExec == nil {
		writeError(w, http.StatusNotFound, "no successful execution found to undo")
		return
	}

	// Parse executed actions from the history record.
	var executedActions []action.ActionResult
	if err := json.Unmarshal(lastExec.ActionsExecuted, &executedActions); err != nil {
		log.Error().Err(err).Int64("history_id", lastExec.ID).Msg("undo: failed to parse actions_executed")
		writeError(w, http.StatusInternalServerError, "failed to parse execution history actions")
		return
	}

	// Collect reversible command actions (in reverse order for correct compensation).
	now := time.Now().UTC()
	var undoResults []undoActionResult
	var reversed, skipped, failed int

	for i := len(executedActions) - 1; i >= 0; i-- {
		ea := executedActions[i]

		// Only reverse successful command actions.
		if ea.ActionType != "command" {
			continue
		}
		if !ea.Success {
			continue
		}

		// Parse the original command config.
		cmdCfg, parseErr := action.ParseCommandConfig(ea.Config)
		if parseErr != nil {
			undoResults = append(undoResults, undoActionResult{
				OriginalCommand: "unknown",
				Status:          "skipped",
				Error:           "could not parse original command: " + parseErr.Error(),
			})
			skipped++
			continue
		}

		reverseCmd, reversible := reverseCommands[cmdCfg.Command]
		if !reversible {
			undoResults = append(undoResults, undoActionResult{
				OriginalCommand: cmdCfg.Command,
				Status:          "irreversible",
			})
			skipped++
			continue
		}

		// Build the reverse command config.
		reverseCfg, _ := json.Marshal(action.CommandConfig{
			Type:    "command",
			Command: reverseCmd,
		})

		// Execute via the command executor targeting the automation's vehicle.
		_, execErr := h.cmdExecutor.Execute(r.Context(), a.VehicleID, reverseCfg)

		result := undoActionResult{
			OriginalCommand: cmdCfg.Command,
			ReverseCommand:  reverseCmd,
		}

		if execErr != nil {
			result.Status = "failed"
			result.Error = execErr.Error()
			failed++
		} else {
			result.Status = "reversed"
			reversed++
		}

		undoResults = append(undoResults, result)
	}

	// Determine overall status.
	overallStatus := "success"
	if reversed == 0 && failed == 0 && skipped > 0 {
		overallStatus = "skipped"
	} else if failed > 0 && reversed == 0 {
		overallStatus = "failed"
	} else if failed > 0 {
		overallStatus = "partial"
	}

	// Log the undo as a history entry.
	undoActionsJSON, _ := json.Marshal(undoResults)
	triggerSnapshot, _ := json.Marshal(map[string]interface{}{
		"type":                "undo",
		"original_history_id": lastExec.ID,
	})
	durationMs := int(time.Since(now).Milliseconds())
	completedAt := time.Now().UTC()

	hist := &models.AutomationHistory{
		AutomationID:       a.ID,
		AutomationName:     a.Name,
		VehicleID:          a.VehicleID,
		TriggeredAt:        now,
		CompletedAt:        &completedAt,
		DurationMs:         &durationMs,
		TriggerType:        "undo",
		TriggerSnapshot:    triggerSnapshot,
		ConditionsMet:      true,
		ConditionsSnapshot: json.RawMessage("[]"),
		ActionsExecuted:    undoActionsJSON,
		ActionsTotal:       reversed + skipped + failed,
		ActionsSucceeded:   reversed,
		ActionsFailed:      failed,
		Status:             "undo",
	}

	if err := h.historyRepo.Create(r.Context(), hist); err != nil {
		log.Error().Err(err).Int64("automation_id", a.ID).Msg("undo: failed to log history")
		writeError(w, http.StatusInternalServerError, "undo executed but failed to log history")
		return
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Int64("original_history_id", lastExec.ID).
		Int("reversed", reversed).
		Int("skipped", skipped).
		Int("failed", failed).
		Str("status", overallStatus).
		Msg("automation undo completed")

	writeJSON(w, http.StatusOK, undoResponse{
		AutomationID:      a.ID,
		AutomationName:    a.Name,
		OriginalHistoryID: lastExec.ID,
		UndoHistoryID:     hist.ID,
		Actions:           undoResults,
		Reversed:          reversed,
		Skipped:           skipped,
		Failed:            failed,
		Status:            overallStatus,
		Timestamp:         now,
	})
}

// ── Import / Export ─────────────────────────────────────────────────────

const exportVersion = 1

// automationExportEnvelope is the top-level JSON document for import/export.
type automationExportEnvelope struct {
	Version     int                    `json:"version"`
	ExportedAt  string                 `json:"exported_at"`
	Automations []automationPortable   `json:"automations"`
}

// automationPortable is a shareable automation definition stripped of
// instance-specific state (IDs, counters, timestamps, secrets).
type automationPortable struct {
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	TriggerType       string          `json:"trigger_type"`
	TriggerConfig     json.RawMessage `json:"trigger_config"`
	Conditions        json.RawMessage `json:"conditions,omitempty"`
	Actions           json.RawMessage `json:"actions"`
	CooldownMinutes   int             `json:"cooldown_minutes"`
	MaxExecutionsHour int             `json:"max_executions_hour"`
	StopOnFailure     bool            `json:"stop_on_failure"`
	NotifyOnRun       bool            `json:"notify_on_run"`
	NotifyOnFailure   bool            `json:"notify_on_failure"`
	SeasonalStart     *int            `json:"seasonal_start,omitempty"`
	SeasonalEnd       *int            `json:"seasonal_end,omitempty"`
	Priority          int             `json:"priority"`
	Tags              []string        `json:"tags,omitempty"`
}

// automationToPortable converts a stored automation to a portable definition,
// stripping instance-specific fields and scrubbing webhook secrets.
func automationToPortable(a *models.Automation) automationPortable {
	tc := a.TriggerConfig
	if a.TriggerType == "webhook" {
		tc = scrubWebhookSecrets(tc)
	}
	return automationPortable{
		Name:              a.Name,
		Description:       a.Description,
		TriggerType:       a.TriggerType,
		TriggerConfig:     tc,
		Conditions:        a.Conditions,
		Actions:           a.Actions,
		CooldownMinutes:   a.CooldownMinutes,
		MaxExecutionsHour: a.MaxExecutionsHour,
		StopOnFailure:     a.StopOnFailure,
		NotifyOnRun:       a.NotifyOnRun,
		NotifyOnFailure:   a.NotifyOnFailure,
		SeasonalStart:     a.SeasonalStart,
		SeasonalEnd:       a.SeasonalEnd,
		Priority:          a.Priority,
		Tags:              a.Tags,
	}
}

// scrubWebhookSecrets removes webhook_token and secret from a webhook
// trigger_config to prevent credential leakage in shared exports.
func scrubWebhookSecrets(raw json.RawMessage) json.RawMessage {
	var m map[string]interface{}
	if json.Unmarshal(raw, &m) != nil {
		return raw
	}
	delete(m, "webhook_token")
	delete(m, "secret")
	result, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return result
}

// injectWebhookToken generates a new unique webhook token and injects it
// into the trigger_config. Returns the updated config and the generated token.
func injectWebhookToken(raw json.RawMessage) (json.RawMessage, string, error) {
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw, "", fmt.Errorf("invalid trigger_config JSON: %w", err)
	}
	token := uuid.New().String()
	m["webhook_token"] = token
	result, err := json.Marshal(m)
	if err != nil {
		return raw, "", fmt.Errorf("marshal trigger_config: %w", err)
	}
	return result, token, nil
}

// buildExportEnvelope creates the top-level export document.
func buildExportEnvelope(automations []automationPortable) automationExportEnvelope {
	return automationExportEnvelope{
		Version:     exportVersion,
		ExportedAt:  time.Now().UTC().Format(time.RFC3339),
		Automations: automations,
	}
}

// ExportOne exports a single automation as a portable JSON document.
//
//	GET /automations/{id}/export
func (h *AutomationHandler) ExportOne(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("export: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	envelope := buildExportEnvelope([]automationPortable{automationToPortable(a)})

	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="automation-%d.json"`, a.ID))

	writeJSONIndent(w, http.StatusOK, envelope)
}

// ExportBatch exports multiple automations as a single portable JSON document.
//
//	POST /automations/export
func (h *AutomationHandler) ExportBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids is required and must not be empty")
		return
	}
	if len(req.IDs) > 100 {
		writeError(w, http.StatusBadRequest, "cannot export more than 100 automations at once")
		return
	}

	portables := make([]automationPortable, 0, len(req.IDs))
	for _, id := range req.IDs {
		a, err := h.repo.GetByID(r.Context(), id)
		if err != nil {
			log.Error().Err(err).Int64("id", id).Msg("export: failed to get automation")
			writeError(w, http.StatusInternalServerError, "failed to get automation")
			return
		}
		if a == nil {
			writeError(w, http.StatusNotFound,
				fmt.Sprintf("automation %d not found", id))
			return
		}
		portables = append(portables, automationToPortable(a))
	}

	envelope := buildExportEnvelope(portables)

	w.Header().Set("Content-Disposition", `attachment; filename="automations.json"`)

	writeJSONIndent(w, http.StatusOK, envelope)
}

// importedAutomation describes a successfully imported automation.
type importedAutomation struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	WebhookToken string `json:"webhook_token,omitempty"`
}

// importError describes a single import failure within a batch.
type importError struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
	Error string `json:"error"`
}

// importResult is the response body for the import endpoint.
type importResult struct {
	Imported []importedAutomation `json:"imported"`
	Errors   []importError        `json:"errors,omitempty"`
}

// Import creates automations from a portable JSON document. All imported
// automations start with enabled=false so the user can review before activating.
// Webhook triggers receive a newly generated token to avoid collisions.
//
//	POST /automations/import
func (h *AutomationHandler) Import(w http.ResponseWriter, r *http.Request) {
	var envelope automationExportEnvelope
	if err := json.NewDecoder(r.Body).Decode(&envelope); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if envelope.Version < 1 || envelope.Version > exportVersion {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("unsupported export version %d (supported: 1–%d)", envelope.Version, exportVersion))
		return
	}
	if len(envelope.Automations) == 0 {
		writeError(w, http.StatusBadRequest, "no automations to import")
		return
	}
	if len(envelope.Automations) > 100 {
		writeError(w, http.StatusBadRequest, "cannot import more than 100 automations at once")
		return
	}

	result := importResult{
		Imported: make([]importedAutomation, 0, len(envelope.Automations)),
	}

	for i, def := range envelope.Automations {
		imported, importErr := h.importSingle(r, i, def)
		if importErr != nil {
			result.Errors = append(result.Errors, *importErr)
			continue
		}
		result.Imported = append(result.Imported, *imported)
	}

	status := http.StatusCreated
	if len(result.Imported) == 0 {
		status = http.StatusUnprocessableEntity
	}

	log.Info().
		Int("imported", len(result.Imported)).
		Int("errors", len(result.Errors)).
		Msg("automations imported")

	writeJSON(w, status, result)
}

// importSingle validates and creates a single automation from a portable definition.
func (h *AutomationHandler) importSingle(
	r *http.Request, index int, def automationPortable,
) (*importedAutomation, *importError) {
	name := strings.TrimSpace(def.Name)
	mkErr := func(msg string) *importError {
		return &importError{Index: index, Name: name, Error: msg}
	}

	// Validate required fields.
	if name == "" {
		return nil, mkErr("name is required")
	}
	if def.TriggerType == "" {
		return nil, mkErr("trigger_type is required")
	}

	triggerConfig := def.TriggerConfig
	var webhookToken string

	// For webhook triggers, inject a fresh token since exports strip secrets.
	if def.TriggerType == "webhook" {
		var err error
		triggerConfig, webhookToken, err = injectWebhookToken(triggerConfig)
		if err != nil {
			return nil, mkErr("failed to generate webhook token: " + err.Error())
		}

		// Verify uniqueness of the generated token.
		if err := h.checkWebhookTokenUniqueness(r, triggerConfig, 0); err != nil {
			return nil, mkErr(err.Error())
		}
	}

	// Validate trigger_config schema.
	if err := trigger.ValidateTriggerConfig(def.TriggerType, triggerConfig); err != nil {
		return nil, mkErr("invalid trigger_config: " + err.Error())
	}

	// Validate actions are parseable.
	if len(def.Actions) > 0 {
		if _, err := action.ParseActions(def.Actions); err != nil {
			return nil, mkErr("invalid actions: " + err.Error())
		}
	}

	a := &models.Automation{
		Name:              name,
		Description:       def.Description,
		Enabled:           false, // always disabled on import
		TriggerType:       def.TriggerType,
		TriggerConfig:     triggerConfig,
		Conditions:        def.Conditions,
		Actions:           def.Actions,
		CooldownMinutes:   def.CooldownMinutes,
		MaxExecutionsHour: def.MaxExecutionsHour,
		StopOnFailure:     def.StopOnFailure,
		NotifyOnRun:       def.NotifyOnRun,
		NotifyOnFailure:   def.NotifyOnFailure,
		SeasonalStart:     def.SeasonalStart,
		SeasonalEnd:       def.SeasonalEnd,
		Priority:          def.Priority,
		Tags:              def.Tags,
	}

	if err := h.repo.Create(r.Context(), a); err != nil {
		log.Error().Err(err).Str("name", name).Msg("import: failed to create automation")
		return nil, mkErr("failed to create automation")
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", name).
		Str("trigger_type", def.TriggerType).
		Msg("automation imported")

	return &importedAutomation{
		ID:           a.ID,
		Name:         name,
		WebhookToken: webhookToken,
	}, nil
}

// writeJSONIndent writes an indented JSON response for human-readable export files.
func writeJSONIndent(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(data)
}
