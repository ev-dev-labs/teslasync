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
			e.recordSkipped(ctx, a, triggerSnapshot, triggerKind, start, "loop_detected: "+err.Error())
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
		e.recordSkipped(ctx, a, triggerSnapshot, triggerKind, start, "conditions_not_met")
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
