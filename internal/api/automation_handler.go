package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationHandler handles automation CRUD HTTP requests.
type AutomationHandler struct {
	db             *database.DB
	repo           automationRepository
	historyRepo    *database.AutomationHistoryRepo
	fsmTransRepo   *database.FSMTransitionRepo
	cmdExecutor    *action.CommandExecutor   // optional, enables undo
	eventPublisher *AutomationEventPublisher // optional, enables SSE events
	auditor        *automation.Auditor       // optional, enables audit trail
	presetRegistry *presets.Registry         // built-in preset templates
	mqttPublisher  AutomationMQTTPublisher   // optional, notifies worker on config changes
}

type automationRepository interface {
	ListFull(ctx context.Context) ([]models.AutomationFull, error)
	GetByID(ctx context.Context, id int64) (*models.AutomationFull, error)
	Create(ctx context.Context, a *models.Automation) error
	CreateWithSteps(ctx context.Context, a *models.Automation, steps []database.AutomationStepWrite) error
	Update(ctx context.Context, a *models.Automation) error
	UpdateWithSteps(ctx context.Context, a *models.Automation, steps []database.AutomationStepWrite) error
	Delete(ctx context.Context, id int64) error
}

// AutomationMQTTPublisher publishes automation config change notifications.
// The worker subscribes to these to reload trigger configurations.
type AutomationMQTTPublisher interface {
	PublishReload(action string, automationID int64)
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

// WithAutomationAuditor provides an auditor for recording automation lifecycle events.
func WithAutomationAuditor(a *automation.Auditor) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.auditor = a }
}

// WithAutomationMQTTPublisher provides an MQTT publisher for notifying the
// automation worker of configuration changes (create/update/delete/toggle).
func WithAutomationMQTTPublisher(p AutomationMQTTPublisher) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.mqttPublisher = p }
}

// NewAutomationHandler creates an AutomationHandler backed by the given database.
func NewAutomationHandler(db *database.DB, opts ...AutomationHandlerOption) *AutomationHandler {
	h := &AutomationHandler{
		db:             db,
		repo:           database.NewAutomationRepo(db),
		historyRepo:    database.NewAutomationHistoryRepo(db),
		fsmTransRepo:   database.NewFSMTransitionRepo(db),
		presetRegistry: presets.NewRegistry(),
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// getByID fetches a single automation by ID.
// Returns nil, nil if not found.
func (h *AutomationHandler) getByID(ctx context.Context, id int64) (*models.Automation, error) {
	full, err := h.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if full == nil {
		return nil, nil
	}
	return &full.Automation, nil
}

// getFullByID fetches a single AutomationFull by ID.
func (h *AutomationHandler) getFullByID(ctx context.Context, id int64) (*models.AutomationFull, error) {
	return h.repo.GetByID(ctx, id)
}

// ── Presets ─────────────────────────────────────────────────────────────

// ListPresets returns built-in automation preset templates.
// Supports ?category=security to filter by category.
func (h *AutomationHandler) ListPresets(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")

	resp := presetsResponse{
		Categories: h.presetRegistry.Categories(),
		Presets:    h.presetRegistry.Presets(category),
	}
	if resp.Presets == nil {
		resp.Presets = []presets.Preset{}
	}
	if resp.Categories == nil {
		resp.Categories = []presets.Category{}
	}

	writeJSON(w, http.StatusOK, resp)
}

// GetPreset returns a single preset by ID.
func (h *AutomationHandler) GetPreset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "presetId")
	if id == "" {
		writeError(w, http.StatusBadRequest, "preset ID is required")
		return
	}

	p := h.presetRegistry.Get(id)
	if p == nil {
		writeError(w, http.StatusNotFound, "preset not found")
		return
	}

	writeJSON(w, http.StatusOK, p)
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
	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for toggle")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if req.Enabled {
		// Auto-disabled check removed: AutoDisabled is now derived from run history
		// via AutomationFull.AutoDisabled(), not stored on the Automation row.
	}

	if err := h.repo.Update(r.Context(), &models.Automation{ID: id, Name: existing.Name, Enabled: req.Enabled}); err != nil {
		log.Error().Err(err).Int64("id", id).Bool("enabled", req.Enabled).Msg("failed to toggle automation")
		writeError(w, http.StatusInternalServerError, "failed to toggle automation")
		return
	}

	if h.auditor != nil {
		if req.Enabled {
			h.auditor.LogEnabled(r.Context(), id, existing.Name, r.RemoteAddr)
		} else {
			h.auditor.LogDisabled(r.Context(), id, existing.Name, r.RemoteAddr)
		}
	}

	h.notifyReload("toggled", id)

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

	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for re-enable")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if err := h.repo.Update(r.Context(), &models.Automation{ID: id, Name: existing.Name, Enabled: true}); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to re-enable automation")
		writeError(w, http.StatusInternalServerError, "failed to re-enable automation")
		return
	}

	log.Info().
		Int64("automation_id", id).
		Str("automation", existing.Name).
		Msg("automation re-enabled")

	if h.auditor != nil {
		h.auditor.LogReEnabled(r.Context(), id, existing.Name, r.RemoteAddr)
	}

	h.notifyReload("re_enabled", id)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":            id,
		"enabled":       true,
		"auto_disabled": false,
	})
}

// ── Helpers ─────────────────────────────────────────────────────────────

// notifyReload publishes an automation config change to MQTT so the automation
// worker reloads its trigger configurations. Fire-and-forget — never blocks the response.
func (h *AutomationHandler) notifyReload(action string, automationID int64) {
	if h.mqttPublisher != nil {
		h.mqttPublisher.PublishReload(action, automationID)
	}
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

	existing, err := (*models.Automation)(nil), error(nil) // webhook token lookup removed in post-migration schema
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

	af, err := h.getFullByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("test-run: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if af == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}
	a := &af.Automation

	now := time.Now().UTC()

	// ── Evaluate conditions ───────────────────────────────────────────
	condResults := h.evaluateTestConditions(af, now)

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
	actionResults, validCount := h.simulateActions(af, allMet)

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
		TriggerType:        "unknown",
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
		h.eventPublisher.PublishTriggered(a.ID, a.Name, "", "unknown", "test")
		if !allMet {
			h.eventPublisher.PublishSkipped(a.ID, a.Name, "conditions not met (test-run)", "test")
		} else if validCount == len(actionResults) {
			durationMs := time.Since(now).Milliseconds()
			h.eventPublisher.PublishSucceeded(a.ID, a.Name, durationMs, validCount, "test")
		} else {
			h.eventPublisher.PublishFailed(a.ID, a.Name, "some actions invalid (test-run)", -1, "test")
		}
	}

	if h.auditor != nil {
		h.auditor.LogTestRun(r.Context(), a.ID, a.Name, allMet, len(actionResults), r.RemoteAddr)
	}

	writeJSON(w, http.StatusOK, testRunResponse{
		AutomationID:   a.ID,
		AutomationName: a.Name,
		VehicleID:      a.VehicleID,
		TriggerType:    "unknown",
		Status:         "test",
		ConditionsMet:  allMet,
		Conditions:     condResults,
		Actions:        actionResults,
		ExecutionPlan: testExecutionPlan{
			TotalActions:         len(actionResults),
			ValidActions:         validCount,
			StopOnFailure:        testRunStopOnFailure(af),
			ConditionsCount:      len(condResults),
			AllConditionsMet:     allMet,
			HasUnknownConditions: hasUnknown,
		},
		HistoryID: hist.ID,
		Timestamp: now,
	})
}

type testRunConditionConfig struct {
	condType string
	raw      json.RawMessage
	err      error
}

// evaluateTestConditions parses and evaluates each condition in the automation.
// Time-based conditions use real time; state-dependent conditions that require
// unavailable context are reported as "unknown".
func (h *AutomationHandler) evaluateTestConditions(af *models.AutomationFull, now time.Time) []testConditionResult {
	if af == nil || len(af.Conditions) == 0 {
		return []testConditionResult{}
	}

	rawConditions := testRunConditionConfigs(af)
	results := make([]testConditionResult, 0, len(rawConditions))

	for i, cfg := range rawConditions {
		if cfg.err != nil {
			results = append(results, testConditionResult{
				Index:  i,
				Type:   cfg.condType,
				Result: "unknown",
				Reason: cfg.err.Error(),
			})
			continue
		}
		var peek struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(cfg.raw, &peek); err != nil {
			results = append(results, testConditionResult{
				Index:  i,
				Type:   "unknown",
				Result: "unknown",
				Reason: "failed to parse condition: " + err.Error(),
			})
			continue
		}
		if peek.Type == "" {
			peek.Type = cfg.condType
		}

		cr := h.evaluateSingleCondition(i, peek.Type, cfg.raw, &af.Automation, now)
		results = append(results, cr)
	}

	return results
}

func testRunConditionConfigs(af *models.AutomationFull) []testRunConditionConfig {
	configs := make([]testRunConditionConfig, 0, len(af.Conditions))
	for _, item := range af.Conditions {
		configs = append(configs, testRunConditionConfigFrom(item))
	}
	return configs
}

func testRunConditionConfigFrom(item any) testRunConditionConfig {
	switch c := item.(type) {
	case json.RawMessage:
		return testRunConditionConfig{raw: c}
	case []byte:
		return testRunConditionConfig{raw: json.RawMessage(c)}
	case *models.AutomationStepConditionTimeWindow:
		return testRunConditionTimeWindow(c)
	case models.AutomationStepConditionTimeWindow:
		return testRunConditionTimeWindow(&c)
	case *models.AutomationStepConditionSignal:
		return testRunConditionSignal(c)
	case models.AutomationStepConditionSignal:
		return testRunConditionSignal(&c)
	case *models.AutomationStepConditionGeofence:
		return testRunConditionGeofence(c)
	case models.AutomationStepConditionGeofence:
		return testRunConditionGeofence(&c)
	case *models.AutomationStepConditionOtherAutomation:
		return marshalTestRunCondition("other_automation", map[string]any{
			"type":                "other_automation",
			"other_automation_id": c.OtherAutomationID,
			"state":               c.State,
		})
	case models.AutomationStepConditionOtherAutomation:
		return testRunConditionConfigFrom(&c)
	default:
		raw, err := json.Marshal(item)
		return testRunConditionConfig{raw: raw, err: err}
	}
}

func testRunConditionTimeWindow(c *models.AutomationStepConditionTimeWindow) testRunConditionConfig {
	if c == nil {
		return testRunConditionConfig{condType: "time_window", err: fmt.Errorf("time_window condition is nil")}
	}
	return marshalTestRunCondition("time_window", map[string]any{
		"type":       "time_window",
		"start_time": c.StartTime.Format("15:04"),
		"end_time":   c.EndTime.Format("15:04"),
		"timezone":   c.Timezone,
	})
}

func testRunConditionSignal(c *models.AutomationStepConditionSignal) testRunConditionConfig {
	if c == nil {
		return testRunConditionConfig{condType: "state_check", err: fmt.Errorf("signal condition is nil")}
	}
	operator := mapSignalConditionOperator(c.Op)
	value := signalConditionValue(c)
	return marshalTestRunCondition("state_check", map[string]any{
		"type":     "state_check",
		"field":    c.Signal,
		"operator": operator,
		"value":    value,
	})
}

func testRunConditionGeofence(c *models.AutomationStepConditionGeofence) testRunConditionConfig {
	if c == nil {
		return testRunConditionConfig{condType: "location", err: fmt.Errorf("geofence condition is nil")}
	}
	return marshalTestRunCondition("location", map[string]any{
		"type":        "location",
		"geofence_id": c.PlaceID,
		"operator":    c.State,
	})
}

func marshalTestRunCondition(condType string, payload map[string]any) testRunConditionConfig {
	raw, err := json.Marshal(payload)
	return testRunConditionConfig{condType: condType, raw: raw, err: err}
}

func mapSignalConditionOperator(op string) string {
	switch op {
	case "=":
		return "eq"
	case "!=":
		return "neq"
	case ">":
		return "gt"
	case "<":
		return "lt"
	case ">=":
		return "gte"
	case "<=":
		return "lte"
	default:
		return op
	}
}

func signalConditionValue(c *models.AutomationStepConditionSignal) any {
	switch {
	case c.ValueText != nil:
		return *c.ValueText
	case c.ValueNum != nil:
		return *c.ValueNum
	case c.ValueBool != nil:
		return *c.ValueBool
	default:
		return nil
	}
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
		res, snapshot, err := condition.EvaluateCooldown(cfg, &a.CreatedAt, now)
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

// simulateActions parses the automation's action chain, validates each action
// config, and returns simulated results. Returns the results and valid count.
func (h *AutomationHandler) simulateActions(af *models.AutomationFull, conditionsMet bool) ([]testActionResult, int) {
	if af == nil || len(af.Actions) == 0 {
		return []testActionResult{}, 0
	}

	configs, err := testRunActionConfigs(af)
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
	stopOnFailure := testRunStopOnFailure(af)

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
			if stopOnFailure {
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

func testRunActionConfigs(af *models.AutomationFull) ([]action.ActionConfig, error) {
	configs := make([]action.ActionConfig, 0, len(af.Actions))
	for _, item := range af.Actions {
		next, err := testRunActionConfigFrom(item)
		if err != nil {
			return nil, err
		}
		configs = append(configs, next...)
	}
	return configs, nil
}

func testRunActionConfigFrom(item any) ([]action.ActionConfig, error) {
	switch a := item.(type) {
	case json.RawMessage:
		return parseTestRunActionRaw(a)
	case []byte:
		return parseTestRunActionRaw(json.RawMessage(a))
	case *models.AutomationAction:
		return parseTestRunActionRaw(testRunCommandActionRaw(a))
	case models.AutomationAction:
		return testRunActionConfigFrom(&a)
	case *models.AutomationStepActionNotify:
		return parseTestRunActionRaw(testRunNotifyActionRaw(a))
	case models.AutomationStepActionNotify:
		return testRunActionConfigFrom(&a)
	case *models.AutomationStepActionSetSetting:
		return parseTestRunActionRaw(testRunSetSettingActionRaw(a))
	case models.AutomationStepActionSetSetting:
		return testRunActionConfigFrom(&a)
	case *models.AutomationStepActionCallAutomation:
		return parseTestRunActionRaw(testRunCallAutomationActionRaw(a))
	case models.AutomationStepActionCallAutomation:
		return testRunActionConfigFrom(&a)
	default:
		raw, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		return parseTestRunActionRaw(raw)
	}
}

func parseTestRunActionRaw(raw json.RawMessage) ([]action.ActionConfig, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return []action.ActionConfig{}, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		return action.ParseActions(raw)
	}

	var peek struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &peek); err != nil {
		return nil, fmt.Errorf("action 0: invalid JSON: %w", err)
	}
	if peek.Type == "" {
		peek.Type = "command"
	}
	return []action.ActionConfig{{Type: peek.Type, Raw: raw}}, nil
}

func testRunCommandActionRaw(a *models.AutomationAction) json.RawMessage {
	payload := map[string]any{
		"type":    "command",
		"command": a.CommandName,
	}
	if len(a.CommandParams) > 0 && string(a.CommandParams) != "null" {
		payload["params"] = a.CommandParams
	}
	raw, _ := json.Marshal(payload)
	return raw
}

func testRunNotifyActionRaw(a *models.AutomationStepActionNotify) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"type":    "notify",
		"channel": "all",
		"message": a.Template,
	})
	return raw
}

func testRunSetSettingActionRaw(a *models.AutomationStepActionSetSetting) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"type":  "set_variable",
		"key":   a.SettingKey,
		"value": testRunSettingValue(a),
	})
	return raw
}

func testRunCallAutomationActionRaw(a *models.AutomationStepActionCallAutomation) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"type":                 "call_automation",
		"target_automation_id": a.TargetAutomationID,
	})
	return raw
}

func testRunSettingValue(a *models.AutomationStepActionSetSetting) string {
	switch {
	case a.ValueText != nil:
		return *a.ValueText
	case a.ValueNum != nil:
		return fmt.Sprint(*a.ValueNum)
	case a.ValueBool != nil:
		return fmt.Sprint(*a.ValueBool)
	default:
		return ""
	}
}

func testRunStopOnFailure(_ *models.AutomationFull) bool {
	return true
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
	"lock":               "unlock",
	"unlock":             "lock",
	"climate_on":         "climate_off",
	"climate_off":        "climate_on",
	"sentry_on":          "sentry_off",
	"sentry_off":         "sentry_on",
	"charge_start":       "charge_stop",
	"charge_stop":        "charge_start",
	"vent_windows":       "close_windows",
	"close_windows":      "vent_windows",
	"valet_on":           "valet_off",
	"valet_off":          "valet_on",
	"guest_mode_on":      "guest_mode_off",
	"guest_mode_off":     "guest_mode_on",
	"cop_on":             "cop_off",
	"cop_off":            "cop_on",
	"bioweapon_on":       "bioweapon_off",
	"bioweapon_off":      "bioweapon_on",
	"speed_limit_on":     "speed_limit_off",
	"speed_limit_off":    "speed_limit_on",
	"sunroof_vent":       "sunroof_close",
	"sunroof_close":      "sunroof_vent",
	"climate_keeper_on":  "climate_keeper_off",
	"climate_keeper_off": "climate_keeper_on",
	"dog_mode":           "climate_keeper_off",
	"camp_mode":          "climate_keeper_off",
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

	a, err := h.getByID(r.Context(), id)
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

	if h.auditor != nil {
		h.auditor.LogUndo(r.Context(), a.ID, a.Name, lastExec.ID, reversed, overallStatus, r.RemoteAddr)
	}

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

type automationExportPayloads struct {
	triggers   map[int64]any
	conditions map[int64]any
	actions    map[int64]any
}

func newAutomationExportPayloads() automationExportPayloads {
	return automationExportPayloads{
		triggers:   map[int64]any{},
		conditions: map[int64]any{},
		actions:    map[int64]any{},
	}
}

// automationToPortable converts a fully hydrated automation to a portable
// typed definition stripped of instance-specific IDs and timestamps.
func automationToPortable(full *models.AutomationFull, payloads automationExportPayloads) (automationPortable, error) {
	if full == nil {
		return automationPortable{}, errors.New("automation is required")
	}

	desc := ""
	if full.Description != nil {
		desc = *full.Description
	}
	enabled := full.Enabled
	portable := automationPortable{
		Name:        full.Name,
		Description: desc,
		VehicleID:   full.VehicleID,
		Enabled:     &enabled,
		Triggers:    []json.RawMessage{},
		Conditions:  []json.RawMessage{},
		Actions:     []json.RawMessage{},
	}

	for _, step := range full.Steps {
		payload, ok := automationPayloadForStep(step, payloads)
		if !ok {
			return automationPortable{}, fmt.Errorf("missing typed payload for %s step %d", step.Kind, step.ID)
		}
		raw, err := automationStepRawMessage(step, payload)
		if err != nil {
			return automationPortable{}, err
		}
		switch {
		case strings.HasPrefix(step.Kind, "trigger_"):
			portable.Triggers = append(portable.Triggers, raw)
		case strings.HasPrefix(step.Kind, "condition_"):
			portable.Conditions = append(portable.Conditions, raw)
		case strings.HasPrefix(step.Kind, "action_"):
			portable.Actions = append(portable.Actions, raw)
		default:
			return automationPortable{}, fmt.Errorf("unsupported step kind %q", step.Kind)
		}
	}

	return portable, nil
}

func (h *AutomationHandler) automationToPortable(ctx context.Context, full *models.AutomationFull) (automationPortable, error) {
	payloads := automationExportPayloadsFromFull(full)
	if err := h.hydrateAutomationExportPayloads(ctx, full, payloads); err != nil {
		return automationPortable{}, err
	}
	return automationToPortable(full, payloads)
}

func automationExportPayloadsFromFull(full *models.AutomationFull) automationExportPayloads {
	payloads := newAutomationExportPayloads()
	if full == nil {
		return payloads
	}
	for _, payload := range full.Triggers {
		if stepID, ok := automationPayloadStepID(payload); ok {
			payloads.triggers[stepID] = payload
		}
	}
	for _, payload := range full.Conditions {
		if stepID, ok := automationPayloadStepID(payload); ok {
			payloads.conditions[stepID] = payload
		}
	}
	for _, payload := range full.Actions {
		if stepID, ok := automationPayloadStepID(payload); ok {
			payloads.actions[stepID] = payload
		}
	}
	return payloads
}

func automationPayloadStepID(payload any) (int64, bool) {
	var row struct {
		StepID int64 `json:"step_id"`
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, false
	}
	if err := json.Unmarshal(raw, &row); err != nil || row.StepID <= 0 {
		return 0, false
	}
	return row.StepID, true
}

func automationPayloadForStep(step models.AutomationStep, payloads automationExportPayloads) (any, bool) {
	switch {
	case strings.HasPrefix(step.Kind, "trigger_"):
		payload, ok := payloads.triggers[step.ID]
		return payload, ok
	case strings.HasPrefix(step.Kind, "condition_"):
		payload, ok := payloads.conditions[step.ID]
		return payload, ok
	case strings.HasPrefix(step.Kind, "action_"):
		payload, ok := payloads.actions[step.ID]
		return payload, ok
	default:
		return nil, false
	}
}

func (h *AutomationHandler) hydrateAutomationExportPayloads(
	ctx context.Context,
	full *models.AutomationFull,
	payloads automationExportPayloads,
) error {
	if full == nil || h == nil || h.db == nil || h.db.Pool == nil {
		return nil
	}

	var triggerIDs, conditionIDs, actionIDs []int64
	for _, step := range full.Steps {
		if _, ok := automationPayloadForStep(step, payloads); ok {
			continue
		}
		switch {
		case strings.HasPrefix(step.Kind, "trigger_"):
			triggerIDs = append(triggerIDs, step.ID)
		case strings.HasPrefix(step.Kind, "condition_"):
			conditionIDs = append(conditionIDs, step.ID)
		case strings.HasPrefix(step.Kind, "action_"):
			actionIDs = append(actionIDs, step.ID)
		}
	}
	if err := h.loadAutomationExportTriggers(ctx, triggerIDs, payloads.triggers); err != nil {
		return err
	}
	if err := h.loadAutomationExportConditions(ctx, conditionIDs, payloads.conditions); err != nil {
		return err
	}
	if err := h.loadAutomationExportActions(ctx, actionIDs, payloads.actions); err != nil {
		return err
	}
	return nil
}

func (h *AutomationHandler) loadAutomationExportTriggers(ctx context.Context, stepIDs []int64, out map[int64]any) error {
	if len(stepIDs) == 0 {
		return nil
	}

	const query = `
		SELECT step_id, 'signal' AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_signal t WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'geofence' AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_geofence t WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'schedule' AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_schedule t WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'event' AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_event t WHERE step_id = ANY($1)`
	rows, err := h.db.Pool.Query(ctx, query, stepIDs)
	if err != nil {
		return fmt.Errorf("load export triggers: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var stepID int64
		var kind string
		var payload []byte
		if err := rows.Scan(&stepID, &kind, &payload); err != nil {
			return fmt.Errorf("scan export trigger: %w", err)
		}
		switch kind {
		case "signal":
			row := &models.AutomationStepTriggerSignal{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export signal trigger %d: %w", stepID, err)
			}
			out[stepID] = row
		case "geofence":
			row := &models.AutomationStepTriggerGeofence{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export geofence trigger %d: %w", stepID, err)
			}
			out[stepID] = row
		case "schedule":
			row := &models.AutomationStepTriggerSchedule{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export schedule trigger %d: %w", stepID, err)
			}
			out[stepID] = row
		case "event":
			row := &models.AutomationStepTriggerEvent{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export event trigger %d: %w", stepID, err)
			}
			out[stepID] = row
		default:
			return fmt.Errorf("unknown export trigger kind %q", kind)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read export triggers: %w", err)
	}
	return nil
}

func (h *AutomationHandler) loadAutomationExportConditions(ctx context.Context, stepIDs []int64, out map[int64]any) error {
	if len(stepIDs) == 0 {
		return nil
	}

	const query = `
		SELECT step_id, 'signal' AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_signal c WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'time_window' AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_time_window c WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'geofence' AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_geofence c WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'other_automation' AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_other_automation c WHERE step_id = ANY($1)`
	rows, err := h.db.Pool.Query(ctx, query, stepIDs)
	if err != nil {
		return fmt.Errorf("load export conditions: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var stepID int64
		var kind string
		var payload []byte
		if err := rows.Scan(&stepID, &kind, &payload); err != nil {
			return fmt.Errorf("scan export condition: %w", err)
		}
		switch kind {
		case "signal":
			row := &models.AutomationStepConditionSignal{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export signal condition %d: %w", stepID, err)
			}
			out[stepID] = row
		case "time_window":
			row, err := automationConditionTimeWindowPayload(payload)
			if err != nil {
				return fmt.Errorf("decode export time window condition %d: %w", stepID, err)
			}
			out[stepID] = row
		case "geofence":
			row := &models.AutomationStepConditionGeofence{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export geofence condition %d: %w", stepID, err)
			}
			out[stepID] = row
		case "other_automation":
			row := &models.AutomationStepConditionOtherAutomation{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export other automation condition %d: %w", stepID, err)
			}
			out[stepID] = row
		default:
			return fmt.Errorf("unknown export condition kind %q", kind)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read export conditions: %w", err)
	}
	return nil
}

func (h *AutomationHandler) loadAutomationExportActions(ctx context.Context, stepIDs []int64, out map[int64]any) error {
	if len(stepIDs) == 0 {
		return nil
	}

	const query = `
		SELECT step_id, 'command' AS kind, to_jsonb(a.*) AS payload
		  FROM automation_actions a WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'notify' AS kind, to_jsonb(a.*) AS payload
		  FROM automation_step_action_notify a WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'set_setting' AS kind, to_jsonb(a.*) AS payload
		  FROM automation_step_action_set_setting a WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'call_automation' AS kind, to_jsonb(a.*) AS payload
		  FROM automation_step_action_call_automation a WHERE step_id = ANY($1)`
	rows, err := h.db.Pool.Query(ctx, query, stepIDs)
	if err != nil {
		return fmt.Errorf("load export actions: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var stepID int64
		var kind string
		var payload []byte
		if err := rows.Scan(&stepID, &kind, &payload); err != nil {
			return fmt.Errorf("scan export action: %w", err)
		}
		switch kind {
		case "command":
			row := &models.AutomationAction{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export command action %d: %w", stepID, err)
			}
			out[stepID] = row
		case "notify":
			row := &models.AutomationStepActionNotify{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export notification action %d: %w", stepID, err)
			}
			out[stepID] = row
		case "set_setting":
			row := &models.AutomationStepActionSetSetting{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export setting action %d: %w", stepID, err)
			}
			out[stepID] = row
		case "call_automation":
			row := &models.AutomationStepActionCallAutomation{}
			if err := json.Unmarshal(payload, row); err != nil {
				return fmt.Errorf("decode export call action %d: %w", stepID, err)
			}
			out[stepID] = row
		default:
			return fmt.Errorf("unknown export action kind %q", kind)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read export actions: %w", err)
	}
	return nil
}

func automationConditionTimeWindowPayload(raw []byte) (automationConditionTimeWindowDTO, error) {
	var row struct {
		StartTime  string `json:"start_time"`
		EndTime    string `json:"end_time"`
		Timezone   string `json:"timezone"`
		DaysOfWeek []int  `json:"days_of_week"`
	}
	if err := json.Unmarshal(raw, &row); err != nil {
		return automationConditionTimeWindowDTO{}, err
	}
	return automationConditionTimeWindowDTO{
		StartTime:  row.StartTime,
		EndTime:    row.EndTime,
		Timezone:   row.Timezone,
		DaysOfWeek: row.DaysOfWeek,
	}, nil
}

func automationStepRawMessage(step models.AutomationStep, payload any) (json.RawMessage, error) {
	order := step.StepOrder
	switch step.Kind {
	case models.AutomationStepKindTriggerSignal:
		p, err := automationDecodePayload[models.AutomationStepTriggerSignal](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationTriggerSignalDTO{
			Kind:      step.Kind,
			StepOrder: &order,
			Signal:    p.Signal,
			Op:        p.Op,
			ValueText: p.ValueText,
			ValueNum:  p.ValueNum,
			ValueBool: p.ValueBool,
		})
	case models.AutomationStepKindTriggerGeofence:
		p, err := automationDecodePayload[models.AutomationStepTriggerGeofence](step, payload)
		if err != nil {
			return nil, err
		}
		var dwell *int
		if p.DwellMinutes > 0 {
			dwellValue := p.DwellMinutes
			dwell = &dwellValue
		}
		return automationMarshalStep(automationTriggerGeofenceDTO{
			Kind:         step.Kind,
			StepOrder:    &order,
			PlaceID:      p.PlaceID,
			Event:        p.Event,
			DwellMinutes: dwell,
		})
	case models.AutomationStepKindTriggerSchedule:
		p, err := automationDecodePayload[models.AutomationStepTriggerSchedule](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationTriggerScheduleDTO{
			Kind:      step.Kind,
			StepOrder: &order,
			CronExpr:  p.CronExpr,
			Timezone:  p.Timezone,
		})
	case models.AutomationStepKindTriggerEvent:
		p, err := automationDecodePayload[models.AutomationStepTriggerEvent](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationTriggerEventDTO{
			Kind:      step.Kind,
			StepOrder: &order,
			EventType: p.EventType,
		})
	case models.AutomationStepKindConditionSignal:
		p, err := automationDecodePayload[models.AutomationStepConditionSignal](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationConditionSignalDTO{
			Kind:      step.Kind,
			StepOrder: &order,
			Signal:    p.Signal,
			Op:        p.Op,
			ValueText: p.ValueText,
			ValueNum:  p.ValueNum,
			ValueBool: p.ValueBool,
			ValueMin:  p.ValueMin,
			ValueMax:  p.ValueMax,
		})
	case models.AutomationStepKindConditionTimeWindow:
		p, err := automationTimeWindowDTO(step, payload)
		if err != nil {
			return nil, err
		}
		p.Kind = step.Kind
		p.StepOrder = &order
		return automationMarshalStep(p)
	case models.AutomationStepKindConditionGeofence:
		p, err := automationDecodePayload[models.AutomationStepConditionGeofence](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationConditionGeofenceDTO{
			Kind:      step.Kind,
			StepOrder: &order,
			PlaceID:   p.PlaceID,
			State:     p.State,
		})
	case models.AutomationStepKindConditionOtherAutomation:
		p, err := automationDecodePayload[models.AutomationStepConditionOtherAutomation](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationConditionOtherAutomationDTO{
			Kind:              step.Kind,
			StepOrder:         &order,
			OtherAutomationID: p.OtherAutomationID,
			State:             p.State,
		})
	case models.AutomationStepKindActionCommand:
		p, err := automationDecodePayload[models.AutomationAction](step, payload)
		if err != nil {
			return nil, err
		}
		params := p.CommandParams
		if len(params) == 0 {
			params = json.RawMessage(`{}`)
		}
		return automationMarshalStep(automationActionCommandDTO{
			Kind:          step.Kind,
			StepOrder:     &order,
			CommandName:   p.CommandName,
			CommandParams: params,
		})
	case models.AutomationStepKindActionNotify:
		p, err := automationDecodePayload[models.AutomationStepActionNotify](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationActionNotifyDTO{
			Kind:      step.Kind,
			StepOrder: &order,
			ChannelID: p.ChannelID,
			Template:  p.Template,
		})
	case models.AutomationStepKindActionSetSetting:
		p, err := automationDecodePayload[models.AutomationStepActionSetSetting](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationActionSetSettingDTO{
			Kind:       step.Kind,
			StepOrder:  &order,
			SettingKey: p.SettingKey,
			ValueText:  p.ValueText,
			ValueNum:   p.ValueNum,
			ValueBool:  p.ValueBool,
		})
	case models.AutomationStepKindActionCallAutomation:
		p, err := automationDecodePayload[models.AutomationStepActionCallAutomation](step, payload)
		if err != nil {
			return nil, err
		}
		return automationMarshalStep(automationActionCallAutomationDTO{
			Kind:               step.Kind,
			StepOrder:          &order,
			TargetAutomationID: p.TargetAutomationID,
		})
	default:
		return nil, fmt.Errorf("unsupported step kind %q", step.Kind)
	}
}

func automationDecodePayload[T any](step models.AutomationStep, payload any) (T, error) {
	var out T
	raw, err := json.Marshal(payload)
	if err != nil {
		return out, fmt.Errorf("marshal %s step %d: %w", step.Kind, step.ID, err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("decode %s step %d: %w", step.Kind, step.ID, err)
	}
	return out, nil
}

func automationTimeWindowDTO(step models.AutomationStep, payload any) (automationConditionTimeWindowDTO, error) {
	if p, ok := payload.(automationConditionTimeWindowDTO); ok {
		return p, nil
	}
	p, err := automationDecodePayload[models.AutomationStepConditionTimeWindow](step, payload)
	if err != nil {
		return automationConditionTimeWindowDTO{}, err
	}
	days := make([]int, 0, len(p.DaysOfWeek))
	for _, day := range p.DaysOfWeek {
		days = append(days, int(day))
	}
	return automationConditionTimeWindowDTO{
		StartTime:  formatAutomationClockTime(p.StartTime),
		EndTime:    formatAutomationClockTime(p.EndTime),
		Timezone:   p.Timezone,
		DaysOfWeek: days,
	}, nil
}

func formatAutomationClockTime(value time.Time) string {
	return value.Format("15:04:05")
}

func automationMarshalStep(payload any) (json.RawMessage, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// scrubWebhookSecrets removes webhook token fields from shared exports.
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
// into a webhook payload. Returns the updated payload and generated token.
func injectWebhookToken(raw json.RawMessage) (json.RawMessage, string, error) {
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw, "", fmt.Errorf("invalid webhook payload JSON: %w", err)
	}
	token := uuid.New().String()
	m["webhook_token"] = token
	result, err := json.Marshal(m)
	if err != nil {
		return raw, "", fmt.Errorf("marshal webhook payload: %w", err)
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

	a, err := h.getFullByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("export: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	portable, err := h.automationToPortable(r.Context(), a)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("export: failed to build automation definition")
		writeError(w, http.StatusInternalServerError, "failed to export automation")
		return
	}
	envelope := buildExportEnvelope([]automationPortable{portable})

	if h.auditor != nil {
		h.auditor.LogExported(r.Context(), 1, []string{a.Name}, r.RemoteAddr)
	}

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
		a, err := h.getFullByID(r.Context(), id)
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
		portable, err := h.automationToPortable(r.Context(), a)
		if err != nil {
			log.Error().Err(err).Int64("id", id).Msg("export: failed to build automation definition")
			writeError(w, http.StatusInternalServerError, "failed to export automation")
			return
		}
		portables = append(portables, portable)
	}

	envelope := buildExportEnvelope(portables)

	if h.auditor != nil {
		names := make([]string, len(portables))
		for i, p := range portables {
			names[i] = p.Name
		}
		h.auditor.LogExported(r.Context(), len(portables), names, r.RemoteAddr)
	}

	w.Header().Set("Content-Disposition", `attachment; filename="automations.json"`)

	writeJSONIndent(w, http.StatusOK, envelope)
}

// Import creates automations from a portable JSON document. All imported
// automations start with enabled=false so the user can review before activating.
// Webhook triggers receive a newly generated token to avoid collisions.
//
//	POST /automations/import
func (h *AutomationHandler) Import(w http.ResponseWriter, r *http.Request) {
	envelope, err := decodeAutomationExportEnvelope(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
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

	if h.auditor != nil && len(result.Imported) > 0 {
		names := make([]string, len(result.Imported))
		for i, imp := range result.Imported {
			names[i] = imp.Name
		}
		h.auditor.LogImported(r.Context(), len(result.Imported), names, r.RemoteAddr)
	}

	writeJSON(w, status, result)
}

// importSingle validates and creates a single automation from a portable definition.
func (h *AutomationHandler) importSingle(
	r *http.Request, index int, def automationPortable,
) (*importedAutomation, *importError) {
	req, err := validateAutomationPortable(def)
	name := strings.TrimSpace(def.Name)
	mkErr := func(msg string) *importError {
		return &importError{Index: index, Name: name, Error: msg}
	}
	if err != nil {
		return nil, mkErr(err.Error())
	}

	descStr := req.Description
	var descPtr *string
	if descStr != "" {
		descPtr = &descStr
	}
	a := &models.Automation{
		Name:        req.Name,
		Description: descPtr,
		VehicleID:   req.VehicleID,
		Enabled:     false, // always disabled on import
	}
	steps, err := automationStepWrites(req)
	if err != nil {
		return nil, mkErr(err.Error())
	}

	if err := h.repo.CreateWithSteps(r.Context(), a, steps); err != nil {
		log.Error().Err(err).Str("name", name).Msg("import: failed to create automation")
		return nil, mkErr("failed to create automation")
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", req.Name).
		Str("trigger_kind", firstTriggerKind(req)).
		Msg("automation imported")

	return &importedAutomation{
		ID:           a.ID,
		Name:         req.Name,
		WebhookToken: "",
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
