// Package automation provides the runtime engine that orchestrates triggers,
// conditions, actions, and safety guards. The Engine implements the
// AutomationEngine interface consumed by all trigger types.
package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/safety"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ── Repository interfaces ──────────────────────────────────────────────

// AutomationStore provides automation data access needed by the Engine.
type AutomationStore interface {
	GetByID(ctx context.Context, id int64) (*models.AutomationFull, error)
	IncrementExecution(ctx context.Context, id int64, success bool) error
}

// HistoryStore provides execution history persistence.
type HistoryStore interface {
	Create(ctx context.Context, h *models.AutomationHistory) error
	Complete(ctx context.Context, id int64, status string, errMsg *string, durationMs int) error
	CountSinceByAutomation(ctx context.Context, automationID int64, since time.Time) (int, error)
}

// StateProvider retrieves current vehicle state for condition evaluation.
// Implementations may read from Redis signal cache, the in-memory signal
// store, or any other real-time source.
type StateProvider interface {
	GetVehicleState(ctx context.Context, vehicleID int64) (*models.VehicleState, error)
}

// PlaceProvider retrieves typed place data for geofence condition evaluation.
type PlaceProvider interface {
	GetByID(ctx context.Context, id int64) (*models.Place, error)
}

// ── Engine ─────────────────────────────────────────────────────────────

// Engine is the runtime core that processes typed automation triggers. It
// implements trigger.AutomationEngine so supported trigger managers call
// Engine.Evaluate after matching typed CTI rows.
//
// The Engine owns the full execution pipeline:
//
//	trigger fires → rate limit → loop detection → conditions → actions → history
type Engine struct {
	mu sync.Mutex // serializes Evaluate per automation (lightweight guard)

	automationRepo AutomationStore
	historyRepo    HistoryStore
	chainExecutor  *action.ChainExecutor
	auditor        *Auditor

	// Safety guards
	rateLimiter  *safety.RateLimiter
	loopDetector *safety.LoopDetector

	// State provider for condition evaluation (reads from Redis / signal store)
	stateProvider StateProvider
	placeProvider PlaceProvider

	// Trigger managers — started/stopped by lifecycle methods.
	cronTrigger     *trigger.CronTrigger
	signalTrigger   *trigger.SignalTrigger
	geofenceTrigger *trigger.GeofenceTrigger
	eventTrigger    *trigger.EventTrigger

	logger zerolog.Logger
}

// EngineOption configures optional Engine dependencies.
type EngineOption func(*Engine)

// WithCronTrigger attaches the schedule trigger manager.
func WithCronTrigger(t *trigger.CronTrigger) EngineOption {
	return func(e *Engine) { e.cronTrigger = t }
}

// WithSignalTrigger attaches the signal trigger evaluator.
func WithSignalTrigger(t *trigger.SignalTrigger) EngineOption {
	return func(e *Engine) { e.signalTrigger = t }
}

// WithGeofenceTrigger attaches the geofence trigger evaluator.
func WithGeofenceTrigger(t *trigger.GeofenceTrigger) EngineOption {
	return func(e *Engine) { e.geofenceTrigger = t }
}

// WithEventTrigger attaches the event trigger evaluator.
func WithEventTrigger(t *trigger.EventTrigger) EngineOption {
	return func(e *Engine) { e.eventTrigger = t }
}

// WithRateLimiter attaches the rate limiter safety guard.
func WithRateLimiter(rl *safety.RateLimiter) EngineOption {
	return func(e *Engine) { e.rateLimiter = rl }
}

// WithLoopDetector attaches the loop detector safety guard.
func WithLoopDetector(ld *safety.LoopDetector) EngineOption {
	return func(e *Engine) { e.loopDetector = ld }
}

// WithAuditor attaches the audit logger.
func WithAuditor(a *Auditor) EngineOption {
	return func(e *Engine) { e.auditor = a }
}

// WithStateProvider attaches a provider for real-time vehicle state lookups.
// Used by signal conditions to evaluate fields like battery_level and speed.
func WithStateProvider(sp StateProvider) EngineOption {
	return func(e *Engine) { e.stateProvider = sp }
}

// WithPlaceProvider attaches typed place lookups for geofence conditions.
func WithPlaceProvider(pp PlaceProvider) EngineOption {
	return func(e *Engine) { e.placeProvider = pp }
}

// NewEngine creates an automation Engine. The repos and chainExecutor are
// required; triggers and safety guards are optional (attach with options).
func NewEngine(
	automationRepo AutomationStore,
	historyRepo HistoryStore,
	chainExecutor *action.ChainExecutor,
	opts ...EngineOption,
) *Engine {
	e := &Engine{
		automationRepo: automationRepo,
		historyRepo:    historyRepo,
		chainExecutor:  chainExecutor,
		logger: log.With().
			Str("component", "automation_engine").
			Logger(),
	}
	for _, opt := range opts {
		opt(e)
	}
	return e
}

// ── Lifecycle ──────────────────────────────────────────────────────────

// Start initialises attached schedule managers. Push-driven typed triggers
// (signal, geofence, event) are called by their domain producers.
func (e *Engine) Start(ctx context.Context) error {
	e.logger.Info().Msg("starting automation engine")

	if e.cronTrigger != nil {
		if err := e.cronTrigger.Start(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to start cron trigger")
		}
	}

	e.logger.Info().Msg("automation engine started")
	return nil
}

// Stop gracefully shuts down all trigger managers.
func (e *Engine) Stop() {
	e.logger.Info().Msg("stopping automation engine")

	if e.cronTrigger != nil {
		e.cronTrigger.Stop()
	}
	if e.geofenceTrigger != nil {
		e.geofenceTrigger.Stop()
	}

	e.logger.Info().Msg("automation engine stopped")
}

// Reload re-reads all trigger configurations from the database. Call this
// when the API creates, updates, deletes, or toggles an automation.
func (e *Engine) Reload(ctx context.Context) error {
	e.logger.Info().Msg("reloading automation engine")

	if e.cronTrigger != nil {
		if err := e.cronTrigger.Reload(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to reload cron trigger")
		}
	}

	e.logger.Info().Msg("automation engine reloaded")
	return nil
}

// ── Evaluate (AutomationEngine interface) ──────────────────────────────

// Evaluate is called by triggers when an automation should fire. It runs
// the full execution pipeline: load → rate-limit → loop-detect → conditions
// → actions → history → counters.
func (e *Engine) Evaluate(ctx context.Context, automationID int64, triggerSnapshot json.RawMessage) error {
	start := time.Now().UTC()

	// Load the automation.
	a, err := e.automationRepo.GetByID(ctx, automationID)
	if err != nil {
		return fmt.Errorf("load automation %d: %w", automationID, err)
	}
	if a == nil {
		return fmt.Errorf("automation %d not found", automationID)
	}
	if !a.Enabled || a.AutoDisabled() {
		e.logger.Debug().
			Int64("automation_id", automationID).
			Bool("enabled", a.Enabled).
			Bool("auto_disabled", a.AutoDisabled()).
			Msg("skipping disabled automation")
		return nil
	}
	triggerKind, err := validateTypedTriggers(a)
	if err != nil {
		return fmt.Errorf("validate typed triggers for automation %d: %w", automationID, err)
	}

	// Rate limit check — MaxExecutionsHour removed in typed migration (000142).
	// Per-automation rate-limiting will be re-derived from step-level config
	// once the CTI children are fully wired. Global rate limiter still guards
	// against runaway loops via the LoopDetector below.

	// Loop detection — check context chain and rapid-fire guard.
	if e.loopDetector != nil {
		newCtx, err := e.loopDetector.BeforeExecute(ctx, automationID)
		if err != nil {
			e.logger.Warn().Err(err).
				Int64("automation_id", automationID).
				Str("automation", a.Name).
				Msg("automation blocked by loop/rapid-fire detection")
			e.recordSkipped(ctx, a, triggerSnapshot, start, "loop_detected: "+err.Error())
			return nil
		}
		ctx = newCtx
	}

	// Evaluate conditions.
	conditionsMet, conditionsSnapshot := e.evaluateConditions(a, start)
	if !conditionsMet {
		e.logger.Info().
			Int64("automation_id", automationID).
			Str("automation", a.Name).
			Msg("conditions not met, skipping actions")
		e.recordSkipped(ctx, a, triggerSnapshot, start, "conditions_not_met")
		return nil
	}

	// Create the initial history record (status=running).
	hist := &models.AutomationHistory{
		AutomationID:       a.ID,
		AutomationName:     a.Name,
		VehicleID:          a.VehicleID,
		TriggeredAt:        start,
		TriggerType:        triggerKind,
		TriggerSnapshot:    triggerSnapshot,
		ConditionsMet:      true,
		ConditionsSnapshot: conditionsSnapshot,
		Status:             "running",
	}
	if err := e.historyRepo.Create(ctx, hist); err != nil {
		e.logger.Error().Err(err).
			Int64("automation_id", automationID).
			Msg("failed to create history record")
		return fmt.Errorf("create history: %w", err)
	}

	actions, err := buildTypedActionConfigs(a.Actions)
	if err != nil {
		errMsg := fmt.Sprintf("invalid actions: %v", err)
		e.completeHistory(ctx, hist.ID, "failed", &errMsg, start)
		_ = e.automationRepo.IncrementExecution(ctx, automationID, false)
		return fmt.Errorf("prepare typed actions for automation %d: %w", automationID, err)
	}

	// Execute the action chain.
	var vehicle *models.Vehicle
	// vehicle lookup deferred to ChainExecutor.Execute which handles nil vehicle
	// StopOnFailure removed in typed migration (000142); default true (safe).
	results := e.chainExecutor.Execute(ctx, actions, vehicle, true)

	// Summarise results.
	succeeded := action.Succeeded(results)
	failed := action.Failed(results)
	skipped := action.SkippedCount(results)
	total := len(results)

	status := "success"
	var errStr *string
	if failed > 0 {
		status = "partial"
		msg := fmt.Sprintf("%d/%d actions failed", failed, total)
		errStr = &msg
	}
	if succeeded == 0 && failed > 0 {
		status = "failed"
	}

	e.completeHistory(ctx, hist.ID, status, errStr, start)

	// Update execution counters.
	_ = e.automationRepo.IncrementExecution(ctx, automationID, status != "failed")

	e.logger.Info().
		Int64("automation_id", automationID).
		Str("automation", a.Name).
		Str("status", status).
		Int("succeeded", succeeded).
		Int("failed", failed).
		Int("skipped", skipped).
		Dur("duration", time.Since(start)).
		Msg("automation evaluation completed")

	// Audit trail.
	if e.auditor != nil {
		e.auditor.LogExecuted(ctx, a.ID, a.Name, triggerKind, status != "failed", time.Since(start).Milliseconds())
	}

	return nil
}

// ── Condition Evaluation ───────────────────────────────────────────────

// conditionResult captures the evaluation of a single condition.
type conditionResult struct {
	Index  int    `json:"index"`
	Type   string `json:"type"`
	Result string `json:"result"` // "met", "not_met", "unknown"
	Reason string `json:"reason"`
}

// evaluateConditions evaluates typed CTI condition children. Unknown payloads
// are treated as not met so legacy JSON bridges cannot silently pass runtime.
func (e *Engine) evaluateConditions(a *models.AutomationFull, now time.Time) (bool, json.RawMessage) {
	if len(a.Conditions) == 0 {
		return true, nil
	}

	allMet := true
	results := make([]conditionResult, 0, len(a.Conditions))
	for i, item := range a.Conditions {
		result := e.evaluateTypedCondition(i, item, a, now)
		results = append(results, result)
		if result.Result != "met" {
			allMet = false
		}
	}

	snapshot, _ := json.Marshal(results)
	return allMet, snapshot
}

func (e *Engine) evaluateTypedCondition(index int, item any, a *models.AutomationFull, now time.Time) conditionResult {
	switch c := item.(type) {
	case *models.AutomationStepConditionSignal:
		return e.evaluateSignalCondition(index, c, a)
	case models.AutomationStepConditionSignal:
		return e.evaluateSignalCondition(index, &c, a)
	case *models.AutomationStepConditionTimeWindow:
		return evaluateTimeWindowCondition(index, c, now)
	case models.AutomationStepConditionTimeWindow:
		return evaluateTimeWindowCondition(index, &c, now)
	case *models.AutomationStepConditionGeofence:
		return e.evaluateGeofenceCondition(index, c, a)
	case models.AutomationStepConditionGeofence:
		return e.evaluateGeofenceCondition(index, &c, a)
	case *models.AutomationStepConditionOtherAutomation:
		return e.evaluateOtherAutomationCondition(index, c, now)
	case models.AutomationStepConditionOtherAutomation:
		return e.evaluateOtherAutomationCondition(index, &c, now)
	default:
		return conditionResult{
			Index:  index,
			Type:   "unknown",
			Result: "unknown",
			Reason: fmt.Sprintf("unsupported typed condition payload %T", item),
		}
	}
}

func evaluateTimeWindowCondition(index int, c *models.AutomationStepConditionTimeWindow, now time.Time) conditionResult {
	cfg := &condition.TimeWindowConfig{
		Type:      "time_window",
		StartTime: c.StartTime.Format("15:04"),
		EndTime:   c.EndTime.Format("15:04"),
		Timezone:  c.Timezone,
	}
	res, _, err := condition.EvaluateTimeWindow(cfg, now)
	if err != nil {
		return conditionResult{Index: index, Type: models.AutomationStepKindConditionTimeWindow, Result: "unknown", Reason: "evaluation error: " + err.Error()}
	}
	return withEvalResult(conditionResult{Index: index, Type: models.AutomationStepKindConditionTimeWindow}, res.Met, res.Reason)
}

func (e *Engine) evaluateSignalCondition(index int, c *models.AutomationStepConditionSignal, a *models.AutomationFull) conditionResult {
	base := conditionResult{Index: index, Type: models.AutomationStepKindConditionSignal}
	state, result := e.currentVehicleState(a, base)
	if result != nil {
		return *result
	}

	actual, ok := vehicleStateSignalValue(state, c.Signal)
	if !ok {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("unsupported signal %q", c.Signal)}
	}
	met, reason := compareConditionSignal(actual, c)
	return withEvalResult(base, met, reason)
}

func (e *Engine) evaluateGeofenceCondition(index int, c *models.AutomationStepConditionGeofence, a *models.AutomationFull) conditionResult {
	base := conditionResult{Index: index, Type: models.AutomationStepKindConditionGeofence}
	if e.placeProvider == nil {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "no place provider configured"}
	}
	state, result := e.currentVehicleState(a, base)
	if result != nil {
		return *result
	}
	place, err := e.placeProvider.GetByID(context.Background(), c.PlaceID)
	if err != nil {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "place lookup failed: " + err.Error()}
	}
	if place == nil {
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("place %d not found", c.PlaceID)}
	}
	inside := distanceMeters(state.Latitude, state.Longitude, place.Latitude, place.Longitude) <= float64(place.RadiusM)
	switch c.State {
	case "inside", "dwell":
		return withEvalResult(base, inside, fmt.Sprintf("vehicle inside place %d = %t", c.PlaceID, inside))
	case "outside":
		return withEvalResult(base, !inside, fmt.Sprintf("vehicle outside place %d = %t", c.PlaceID, !inside))
	default:
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("unsupported geofence condition state %q", c.State)}
	}
}

func (e *Engine) evaluateOtherAutomationCondition(index int, c *models.AutomationStepConditionOtherAutomation, now time.Time) conditionResult {
	base := conditionResult{Index: index, Type: models.AutomationStepKindConditionOtherAutomation}
	switch c.State {
	case "enabled", "disabled":
		other, err := e.automationRepo.GetByID(context.Background(), c.OtherAutomationID)
		if err != nil {
			return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "other automation lookup failed: " + err.Error()}
		}
		if other == nil {
			return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("automation %d not found", c.OtherAutomationID)}
		}
		met := other.Enabled
		if c.State == "disabled" {
			met = !other.Enabled
		}
		return withEvalResult(base, met, fmt.Sprintf("automation %d is %s = %t", c.OtherAutomationID, c.State, met))
	case "recently_triggered":
		count, err := e.historyRepo.CountSinceByAutomation(context.Background(), c.OtherAutomationID, now.Add(-time.Hour))
		if err != nil {
			return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: "history lookup failed: " + err.Error()}
		}
		return withEvalResult(base, count > 0, fmt.Sprintf("automation %d executions in last hour = %d", c.OtherAutomationID, count))
	default:
		return conditionResult{Index: index, Type: base.Type, Result: "unknown", Reason: fmt.Sprintf("unsupported other automation state %q", c.State)}
	}
}

func (e *Engine) currentVehicleState(a *models.AutomationFull, base conditionResult) (*models.VehicleState, *conditionResult) {
	if e.stateProvider == nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "no state provider configured"}
	}
	if a.VehicleID == nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "no vehicle scope"}
	}
	state, err := e.stateProvider.GetVehicleState(context.Background(), *a.VehicleID)
	if err != nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "state lookup failed: " + err.Error()}
	}
	if state == nil {
		return nil, &conditionResult{Index: base.Index, Type: base.Type, Result: "unknown", Reason: "no state data"}
	}
	return state, nil
}

func withEvalResult(base conditionResult, met bool, reason string) conditionResult {
	if met {
		base.Result = "met"
	} else {
		base.Result = "not_met"
	}
	base.Reason = reason
	return base
}

func validateTypedTriggers(a *models.AutomationFull) (string, error) {
	triggerSteps := make(map[int64]string)
	var firstKind string
	for _, step := range a.Steps {
		switch step.Kind {
		case models.AutomationStepKindTriggerSignal,
			models.AutomationStepKindTriggerGeofence,
			models.AutomationStepKindTriggerSchedule,
			models.AutomationStepKindTriggerEvent:
			triggerSteps[step.ID] = step.Kind
			if firstKind == "" {
				firstKind = step.Kind
			}
		}
	}
	if len(triggerSteps) == 0 {
		return "", fmt.Errorf("automation has no typed trigger step")
	}

	seen := make(map[int64]string, len(a.Triggers))
	for _, item := range a.Triggers {
		switch t := item.(type) {
		case *models.AutomationStepTriggerSignal:
			seen[t.StepID] = models.AutomationStepKindTriggerSignal
		case models.AutomationStepTriggerSignal:
			seen[t.StepID] = models.AutomationStepKindTriggerSignal
		case *models.AutomationStepTriggerGeofence:
			seen[t.StepID] = models.AutomationStepKindTriggerGeofence
		case models.AutomationStepTriggerGeofence:
			seen[t.StepID] = models.AutomationStepKindTriggerGeofence
		case *models.AutomationStepTriggerSchedule:
			seen[t.StepID] = models.AutomationStepKindTriggerSchedule
		case models.AutomationStepTriggerSchedule:
			seen[t.StepID] = models.AutomationStepKindTriggerSchedule
		case *models.AutomationStepTriggerEvent:
			seen[t.StepID] = models.AutomationStepKindTriggerEvent
		case models.AutomationStepTriggerEvent:
			seen[t.StepID] = models.AutomationStepKindTriggerEvent
		default:
			return "", fmt.Errorf("unsupported trigger payload %T", item)
		}
	}
	for stepID, kind := range triggerSteps {
		if seenKind, ok := seen[stepID]; !ok {
			return "", fmt.Errorf("missing typed trigger child for step %d kind %s", stepID, kind)
		} else if seenKind != kind {
			return "", fmt.Errorf("trigger child kind %s does not match step %d kind %s", seenKind, stepID, kind)
		}
	}
	return firstKind, nil
}

func buildTypedActionConfigs(items []any) ([]action.ActionConfig, error) {
	configs := make([]action.ActionConfig, 0, len(items))
	for i, item := range items {
		switch a := item.(type) {
		case *models.AutomationAction:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d command snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "command", Raw: raw, Payload: a})
		case models.AutomationAction:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d command snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "command", Raw: raw, Payload: &payload})
		case *models.AutomationStepActionNotify:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d notify snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "notify", Raw: raw, Payload: a})
		case models.AutomationStepActionNotify:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d notify snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "notify", Raw: raw, Payload: &payload})
		case *models.AutomationStepActionSetSetting:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d set_setting snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "set_setting", Raw: raw, Payload: a})
		case models.AutomationStepActionSetSetting:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d set_setting snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "set_setting", Raw: raw, Payload: &payload})
		case *models.AutomationStepActionCallAutomation:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d call_automation snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "call_automation", Raw: raw, Payload: a})
		case models.AutomationStepActionCallAutomation:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d call_automation snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "call_automation", Raw: raw, Payload: &payload})
		default:
			return nil, fmt.Errorf("action %d has unsupported typed payload %T", i, item)
		}
	}
	return configs, nil
}

func vehicleStateSignalValue(state *models.VehicleState, signal string) (any, bool) {
	switch signal {
	case "state":
		return state.State, true
	case "latitude":
		return state.Latitude, true
	case "longitude":
		return state.Longitude, true
	case "speed":
		return state.Speed, true
	case "power":
		return state.Power, true
	case "battery_level":
		return float64(state.BatteryLevel), true
	case "rated_range":
		return state.RatedRange, true
	case "ideal_range":
		return state.IdealRange, true
	case "odometer":
		return state.Odometer, true
	case "inside_temp":
		return state.InsideTemp, true
	case "outside_temp":
		return state.OutsideTemp, true
	case "is_climate_on":
		return state.IsClimateOn, true
	case "is_charging":
		return state.IsCharging, true
	case "charger_power":
		return state.ChargerPower, true
	case "charge_rate":
		return state.ChargeRate, true
	case "time_to_full_charge":
		return state.TimeToFullChg, true
	case "is_locked":
		return state.IsLocked, true
	case "sentry_mode":
		return state.SentryMode, true
	case "software_version":
		return state.SoftwareVersion, true
	default:
		return nil, false
	}
}

func compareConditionSignal(actual any, c *models.AutomationStepConditionSignal) (bool, string) {
	if c.Op == "between" {
		actualNum, ok := numberValue(actual)
		if !ok || c.ValueMin == nil || c.ValueMax == nil {
			return false, fmt.Sprintf("%s between requires numeric actual, value_min, and value_max", c.Signal)
		}
		met := actualNum >= *c.ValueMin && actualNum <= *c.ValueMax
		return met, fmt.Sprintf("%s=%v between %v and %v", c.Signal, actualNum, *c.ValueMin, *c.ValueMax)
	}

	expected, ok := expectedConditionValue(c)
	if !ok {
		return false, fmt.Sprintf("%s condition has no expected value", c.Signal)
	}
	met := compareValue(actual, c.Op, expected)
	return met, fmt.Sprintf("%s=%v %s %v", c.Signal, actual, c.Op, expected)
}

func expectedConditionValue(c *models.AutomationStepConditionSignal) (any, bool) {
	switch {
	case c.ValueText != nil:
		return *c.ValueText, true
	case c.ValueNum != nil:
		return *c.ValueNum, true
	case c.ValueBool != nil:
		return *c.ValueBool, true
	default:
		return nil, false
	}
}

func compareValue(actual any, op string, expected any) bool {
	switch e := expected.(type) {
	case bool:
		a, ok := actual.(bool)
		if !ok {
			return false
		}
		switch op {
		case "=":
			return a == e
		case "!=":
			return a != e
		default:
			return false
		}
	case float64:
		a, ok := numberValue(actual)
		if !ok {
			return false
		}
		switch op {
		case "=":
			return a == e
		case "!=":
			return a != e
		case ">":
			return a > e
		case ">=":
			return a >= e
		case "<":
			return a < e
		case "<=":
			return a <= e
		default:
			return false
		}
	case string:
		a := fmt.Sprint(actual)
		switch op {
		case "=":
			return a == e
		case "!=":
			return a != e
		case "in":
			return a == e
		default:
			return false
		}
	default:
		return false
	}
}

func numberValue(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float32:
		return float64(n), true
	case float64:
		return n, true
	default:
		return 0, false
	}
}

func distanceMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000.0
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadiusM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// ── History Helpers ────────────────────────────────────────────────────

// recordSkipped writes a history record for a skipped execution.
func (e *Engine) recordSkipped(ctx context.Context, a *models.AutomationFull, triggerSnapshot json.RawMessage, start time.Time, reason string) {
	durationMs := int(time.Since(start).Milliseconds())
	completedAt := time.Now().UTC()
	hist := &models.AutomationHistory{
		AutomationID:    a.ID,
		AutomationName:  a.Name,
		VehicleID:       a.VehicleID,
		TriggeredAt:     start,
		CompletedAt:     &completedAt,
		DurationMs:      &durationMs,
		TriggerType:     a.TriggerType(),
		TriggerSnapshot: triggerSnapshot,
		Status:          "skipped",
		Error:           &reason,
	}
	if err := e.historyRepo.Create(ctx, hist); err != nil {
		e.logger.Error().Err(err).
			Int64("automation_id", a.ID).
			Str("reason", reason).
			Msg("failed to record skipped execution")
	}
}

// completeHistory updates a running history record with final status.
func (e *Engine) completeHistory(ctx context.Context, historyID int64, status string, errMsg *string, start time.Time) {
	durationMs := int(time.Since(start).Milliseconds())
	if err := e.historyRepo.Complete(ctx, historyID, status, errMsg, durationMs); err != nil {
		e.logger.Error().Err(err).
			Int64("history_id", historyID).
			Str("status", status).
			Msg("failed to complete history record")
	}
}

// ── Trigger Setters (for two-phase initialization) ─────────────────────

// SetCronTrigger attaches the schedule trigger after construction.
func (e *Engine) SetCronTrigger(t *trigger.CronTrigger) { e.cronTrigger = t }

// SetSignalTrigger attaches the signal trigger after construction.
func (e *Engine) SetSignalTrigger(t *trigger.SignalTrigger) { e.signalTrigger = t }

// SetGeofenceTrigger attaches the geofence trigger after construction.
func (e *Engine) SetGeofenceTrigger(t *trigger.GeofenceTrigger) { e.geofenceTrigger = t }

// SetEventTrigger attaches the event trigger after construction.
func (e *Engine) SetEventTrigger(t *trigger.EventTrigger) { e.eventTrigger = t }

// ── Accessors for Push-Driven Triggers ─────────────────────────────────

// SignalTrigger returns the signal trigger evaluator (or nil).
func (e *Engine) SignalTrigger() *trigger.SignalTrigger { return e.signalTrigger }

// GeofenceTrigger returns the geofence trigger evaluator (or nil).
func (e *Engine) GeofenceTrigger() *trigger.GeofenceTrigger { return e.geofenceTrigger }

// EventTrigger returns the event trigger evaluator (or nil).
func (e *Engine) EventTrigger() *trigger.EventTrigger { return e.eventTrigger }
