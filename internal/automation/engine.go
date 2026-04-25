// Package automation provides the runtime engine that orchestrates triggers,
// conditions, actions, and safety guards. The Engine implements the
// AutomationEngine interface consumed by all trigger types.
package automation

import (
	"context"
	"encoding/json"
	"fmt"
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

// ── Engine ─────────────────────────────────────────────────────────────

// Engine is the runtime core that processes automation triggers. It implements
// the trigger.AutomationEngine interface so all trigger types (cron, mqtt,
// battery, geofence, etc.) call Engine.Evaluate when they fire.
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

	// Trigger managers — started/stopped by lifecycle methods
	cronTrigger         *trigger.CronTrigger
	mqttTrigger         *trigger.MQTTTrigger
	sunriseSunsetTrigger *trigger.SunriseSunsetTrigger
	calendarTrigger     *trigger.CalendarTrigger
	batteryTrigger      *trigger.BatteryTrigger
	geofenceTrigger     *trigger.GeofenceTrigger
	energyTrigger       *trigger.EnergyTrigger
	vehicleStateTrigger *trigger.VehicleStateTrigger
	webhookTrigger      *trigger.WebhookTrigger

	logger zerolog.Logger
}

// EngineOption configures optional Engine dependencies.
type EngineOption func(*Engine)

// WithCronTrigger attaches the cron trigger manager.
func WithCronTrigger(t *trigger.CronTrigger) EngineOption {
	return func(e *Engine) { e.cronTrigger = t }
}

// WithMQTTTrigger attaches the MQTT trigger manager.
func WithMQTTTrigger(t *trigger.MQTTTrigger) EngineOption {
	return func(e *Engine) { e.mqttTrigger = t }
}

// WithSunriseSunsetTrigger attaches the sunrise/sunset trigger manager.
func WithSunriseSunsetTrigger(t *trigger.SunriseSunsetTrigger) EngineOption {
	return func(e *Engine) { e.sunriseSunsetTrigger = t }
}

// WithCalendarTrigger attaches the calendar trigger manager.
func WithCalendarTrigger(t *trigger.CalendarTrigger) EngineOption {
	return func(e *Engine) { e.calendarTrigger = t }
}

// WithBatteryTrigger attaches the battery trigger evaluator.
func WithBatteryTrigger(t *trigger.BatteryTrigger) EngineOption {
	return func(e *Engine) { e.batteryTrigger = t }
}

// WithGeofenceTrigger attaches the geofence trigger evaluator.
func WithGeofenceTrigger(t *trigger.GeofenceTrigger) EngineOption {
	return func(e *Engine) { e.geofenceTrigger = t }
}

// WithEnergyTrigger attaches the energy trigger evaluator.
func WithEnergyTrigger(t *trigger.EnergyTrigger) EngineOption {
	return func(e *Engine) { e.energyTrigger = t }
}

// WithVehicleStateTrigger attaches the vehicle state trigger evaluator.
func WithVehicleStateTrigger(t *trigger.VehicleStateTrigger) EngineOption {
	return func(e *Engine) { e.vehicleStateTrigger = t }
}

// WithWebhookTrigger attaches the webhook trigger processor.
func WithWebhookTrigger(t *trigger.WebhookTrigger) EngineOption {
	return func(e *Engine) { e.webhookTrigger = t }
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
// Used by state_check conditions to evaluate fields like battery_level, speed, etc.
func WithStateProvider(sp StateProvider) EngineOption {
	return func(e *Engine) { e.stateProvider = sp }
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

// Start initialises all attached trigger managers. Manager-style triggers
// (cron, mqtt, sunrise/sunset, calendar) have Start() methods that load
// their configurations from the DB and begin watching. Push-driven triggers
// (battery, geofence, energy, vehicle_state) have no Start — they are
// called externally when telemetry data arrives.
func (e *Engine) Start(ctx context.Context) error {
	e.logger.Info().Msg("starting automation engine")

	if e.cronTrigger != nil {
		if err := e.cronTrigger.Start(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to start cron trigger")
		}
	}
	if e.mqttTrigger != nil {
		if err := e.mqttTrigger.Start(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to start mqtt trigger")
		}
	}
	if e.sunriseSunsetTrigger != nil {
		if err := e.sunriseSunsetTrigger.Start(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to start sunrise/sunset trigger")
		}
	}
	if e.calendarTrigger != nil {
		if err := e.calendarTrigger.Start(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to start calendar trigger")
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
	if e.mqttTrigger != nil {
		e.mqttTrigger.Stop()
	}
	if e.sunriseSunsetTrigger != nil {
		e.sunriseSunsetTrigger.Stop()
	}
	if e.calendarTrigger != nil {
		e.calendarTrigger.Stop()
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
	if e.mqttTrigger != nil {
		if err := e.mqttTrigger.Reload(ctx); err != nil {
			e.logger.Error().Err(err).Msg("failed to reload mqtt trigger")
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
		TriggerType:        a.TriggerType(),
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

	// Parse actions — marshal []any to JSON for action.ParseActions.
	actionsJSON, err := json.Marshal(a.Actions)
	if err != nil {
		errMsg := fmt.Sprintf("failed to marshal actions: %v", err)
		e.completeHistory(ctx, hist.ID, "failed", &errMsg, start)
		_ = e.automationRepo.IncrementExecution(ctx, automationID, false)
		return fmt.Errorf("marshal actions for automation %d: %w", automationID, err)
	}
	actions, err := action.ParseActions(actionsJSON)
	if err != nil {
		errMsg := fmt.Sprintf("invalid actions: %v", err)
		e.completeHistory(ctx, hist.ID, "failed", &errMsg, start)
		_ = e.automationRepo.IncrementExecution(ctx, automationID, false)
		return fmt.Errorf("parse actions for automation %d: %w", automationID, err)
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

	actionsJSON, _ = json.Marshal(results)

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
		e.auditor.LogExecuted(ctx, a.ID, a.Name, a.TriggerType(), status != "failed", time.Since(start).Milliseconds())
	}

	_ = actionsJSON // used in history update; kept for future SSE publishing

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

// evaluateConditions parses and evaluates all conditions on the automation.
// Returns whether all conditions are met and a JSON snapshot of results.
func (e *Engine) evaluateConditions(a *models.AutomationFull, now time.Time) (bool, json.RawMessage) {
	if len(a.Conditions) == 0 {
		return true, nil
	}

	condJSON, err := json.Marshal(a.Conditions)
	if err != nil {
		e.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Msg("failed to marshal conditions")
		return true, nil
	}

	var rawConditions []json.RawMessage
	if err := json.Unmarshal(condJSON, &rawConditions); err != nil {
		e.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Msg("failed to parse conditions array")
		return true, nil // allow execution on parse failure
	}

	allMet := true
	results := make([]conditionResult, 0, len(rawConditions))

	for i, raw := range rawConditions {
		var peek struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &peek); err != nil {
			results = append(results, conditionResult{
				Index:  i,
				Type:   "unknown",
				Result: "unknown",
				Reason: "failed to parse condition: " + err.Error(),
			})
			continue
		}

		cr := e.evaluateSingleCondition(i, peek.Type, raw, a, now)
		results = append(results, cr)
		if cr.Result == "not_met" {
			allMet = false
		}
	}

	snapshot, _ := json.Marshal(results)
	return allMet, snapshot
}

// evaluateSingleCondition dispatches to the appropriate condition evaluator.
func (e *Engine) evaluateSingleCondition(
	index int, condType string, raw json.RawMessage,
	a *models.AutomationFull, now time.Time,
) conditionResult {
	base := conditionResult{Index: index, Type: condType}

	switch condType {
	case "time_window":
		cfg, err := condition.ParseTimeWindowConfig(raw)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "invalid config: " + err.Error()}
		}
		res, _, err := condition.EvaluateTimeWindow(cfg, now)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "evaluation error: " + err.Error()}
		}
		return withEvalResult(base, res.Met)

	case "day_filter":
		cfg, err := condition.ParseDayFilterConfig(raw)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "invalid config: " + err.Error()}
		}
		res, _, err := condition.EvaluateDayFilter(cfg, now)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "evaluation error: " + err.Error()}
		}
		return withEvalResult(base, res.Met)

	case "seasonal":
		cfg, err := condition.ParseSeasonalConfig(raw)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "invalid config: " + err.Error()}
		}
		res, _, err := condition.EvaluateSeasonal(cfg, now)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "evaluation error: " + err.Error()}
		}
		return withEvalResult(base, res.Met)

	case "cooldown":
		cfg, err := condition.ParseCooldownConfig(raw)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "invalid config: " + err.Error()}
		}
		// LastTriggeredAt removed in typed migration (000142); pass nil (never triggered).
		// TODO: derive from automation_history once wired.
		res, _, err := condition.EvaluateCooldown(cfg, nil, now)
		if err != nil {
			return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "evaluation error: " + err.Error()}
		}
		return withEvalResult(base, res.Met)

	case "state_check":
		return e.evaluateStateCheck(index, condType, raw, a)

	case "location", "variable_check":
		// Location and variable conditions require additional data sources
		// not yet wired. Default-allow until fully implemented.
		return conditionResult{Index: index, Type: condType, Result: "met", Reason: "state-dependent condition (default-allow)"}

	default:
		return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: fmt.Sprintf("unsupported condition type %q", condType)}
	}
}

func withEvalResult(base conditionResult, met bool) conditionResult {
	if met {
		base.Result = "met"
		base.Reason = "condition satisfied"
	} else {
		base.Result = "not_met"
		base.Reason = "condition not satisfied"
	}
	return base
}

// evaluateStateCheck evaluates a state_check condition by reading the current
// vehicle state from the StateProvider (Redis signal cache). If no provider
// is configured or the automation has no vehicle scope, falls back to
// default-allow to preserve backward compatibility.
func (e *Engine) evaluateStateCheck(index int, condType string, raw json.RawMessage, a *models.AutomationFull) conditionResult {
	base := conditionResult{Index: index, Type: condType}

	if e.stateProvider == nil {
		e.logger.Debug().
			Int64("automation_id", a.ID).
			Msg("state_check: no state provider configured, default-allow")
		return conditionResult{Index: index, Type: condType, Result: "met", Reason: "no state provider (default-allow)"}
	}

	if a.VehicleID == nil {
		e.logger.Debug().
			Int64("automation_id", a.ID).
			Msg("state_check: automation has no vehicle scope, default-allow")
		return conditionResult{Index: index, Type: condType, Result: "met", Reason: "no vehicle scope (default-allow)"}
	}

	cfg, err := condition.ParseStateCheckConfig(raw)
	if err != nil {
		return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "invalid config: " + err.Error()}
	}

	ctx := context.Background()
	state, err := e.stateProvider.GetVehicleState(ctx, *a.VehicleID)
	if err != nil {
		e.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Int64("vehicle_id", *a.VehicleID).
			Msg("state_check: failed to get vehicle state, default-allow")
		return conditionResult{Index: index, Type: condType, Result: "met", Reason: "state lookup failed (default-allow)"}
	}

	if state == nil {
		e.logger.Debug().
			Int64("automation_id", a.ID).
			Int64("vehicle_id", *a.VehicleID).
			Msg("state_check: no state available, default-allow")
		return conditionResult{Index: index, Type: condType, Result: "met", Reason: "no state data (default-allow)"}
	}

	res, _, err := condition.EvaluateStateCheck(cfg, state)
	if err != nil {
		return conditionResult{Index: index, Type: condType, Result: "unknown", Reason: "evaluation error: " + err.Error()}
	}

	result := withEvalResult(base, res.Met)
	result.Reason = res.Reason
	return result
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

// ── Accessors for Push-Driven Triggers ─────────────────────────────────

// ── Trigger Setters (for two-phase initialization) ─────────────────────

// SetCronTrigger attaches the cron trigger after construction.
func (e *Engine) SetCronTrigger(t *trigger.CronTrigger) { e.cronTrigger = t }

// SetMQTTTrigger attaches the MQTT trigger after construction.
func (e *Engine) SetMQTTTrigger(t *trigger.MQTTTrigger) { e.mqttTrigger = t }

// SetSunriseSunsetTrigger attaches the sunrise/sunset trigger after construction.
func (e *Engine) SetSunriseSunsetTrigger(t *trigger.SunriseSunsetTrigger) {
	e.sunriseSunsetTrigger = t
}

// SetCalendarTrigger attaches the calendar trigger after construction.
func (e *Engine) SetCalendarTrigger(t *trigger.CalendarTrigger) { e.calendarTrigger = t }

// SetBatteryTrigger attaches the battery trigger after construction.
func (e *Engine) SetBatteryTrigger(t *trigger.BatteryTrigger) { e.batteryTrigger = t }

// SetGeofenceTrigger attaches the geofence trigger after construction.
func (e *Engine) SetGeofenceTrigger(t *trigger.GeofenceTrigger) { e.geofenceTrigger = t }

// SetEnergyTrigger attaches the energy trigger after construction.
func (e *Engine) SetEnergyTrigger(t *trigger.EnergyTrigger) { e.energyTrigger = t }

// SetVehicleStateTrigger attaches the vehicle state trigger after construction.
func (e *Engine) SetVehicleStateTrigger(t *trigger.VehicleStateTrigger) {
	e.vehicleStateTrigger = t
}

// SetWebhookTrigger attaches the webhook trigger after construction.
func (e *Engine) SetWebhookTrigger(t *trigger.WebhookTrigger) { e.webhookTrigger = t }

// ── Accessors for Push-Driven Triggers ─────────────────────────────────

// BatteryTrigger returns the battery trigger evaluator (or nil).
func (e *Engine) BatteryTrigger() *trigger.BatteryTrigger { return e.batteryTrigger }

// GeofenceTrigger returns the geofence trigger evaluator (or nil).
func (e *Engine) GeofenceTrigger() *trigger.GeofenceTrigger { return e.geofenceTrigger }

// EnergyTrigger returns the energy trigger evaluator (or nil).
func (e *Engine) EnergyTrigger() *trigger.EnergyTrigger { return e.energyTrigger }

// VehicleStateTrigger returns the vehicle state trigger evaluator (or nil).
func (e *Engine) VehicleStateTrigger() *trigger.VehicleStateTrigger { return e.vehicleStateTrigger }

// WebhookTrigger returns the webhook trigger processor (or nil).
func (e *Engine) WebhookTrigger() *trigger.WebhookTrigger { return e.webhookTrigger }
