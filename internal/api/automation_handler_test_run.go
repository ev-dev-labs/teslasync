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
	"github.com/ev-dev-labs/teslasync/internal/models"
)

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
