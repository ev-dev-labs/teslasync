package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationHandler handles automation CRUD HTTP requests.
type AutomationHandler struct {
	repo *database.AutomationRepo
}

// NewAutomationHandler creates an AutomationHandler backed by the given database.
func NewAutomationHandler(db *database.DB) *AutomationHandler {
	return &AutomationHandler{
		repo: database.NewAutomationRepo(db),
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
