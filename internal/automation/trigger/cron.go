// Package trigger implements automation trigger evaluators.
// Each trigger type (cron, event, threshold, etc.) gets its own file.
package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationEngine is the interface called when a trigger fires.
type AutomationEngine interface {
	Evaluate(ctx context.Context, automationID int64, triggerSnapshot json.RawMessage) error
}

// CronAutomation is the hydrated view CronTrigger consumes: an enabled
// automation paired with the typed schedule-trigger CTI row that drives it.
//
// Per ADR-012 (Option A), consumers receive Go-typed CTI children rather than
// reading JSONB blobs from the parent row; per ADR-004 the legacy "cron"
// trigger kind is expressed as a schedule trigger, so the relevant CTI table
// is `automation_step_trigger_schedule`.
type CronAutomation struct {
	Automation models.Automation
	Trigger    models.AutomationStepTriggerSchedule
}

// CronRepo is the narrow port CronTrigger needs from the persistence layer.
// The implementation is expected to load enabled automations whose (single)
// trigger step is a schedule trigger, returning each parent paired with its
// typed CTI row in one batched query (ADR-012 Option A; ADR-005 N+1
// prevention).
//
// Per ADR-012 sub-decision (ii), `auto_disabled` is retired: invalid
// schedules are logged and skipped at registration time; no database write
// is performed against the parent automation.
type CronRepo interface {
	LoadEnabledScheduleTriggers(ctx context.Context) ([]CronAutomation, error)
}

// cronSnapshot is the JSON payload passed to engine.Evaluate when a cron fires.
type cronSnapshot struct {
	FiredAt  string `json:"fired_at"`
	CronExpr string `json:"cron_expr"`
}

// CronTrigger manages cron-based automation scheduling using robfig/cron.
type CronTrigger struct {
	mu        sync.RWMutex
	scheduler *cron.Cron
	repo      CronRepo
	engine    AutomationEngine
	entries   map[int64]cron.EntryID // automationID → cron entry
	ctx       context.Context
	cancel    context.CancelFunc
	logger    zerolog.Logger
}

// NewCronTrigger creates a new cron trigger manager.
// The scheduler uses standard 5-field cron expressions (minute-level granularity)
// and skips overlapping executions for the same automation.
func NewCronTrigger(repo CronRepo, engine AutomationEngine) *CronTrigger {
	ctx, cancel := context.WithCancel(context.Background())
	return &CronTrigger{
		scheduler: cron.New(
			cron.WithParser(cron.NewParser(
				cron.Minute|cron.Hour|cron.Dom|cron.Month|cron.Dow|cron.Descriptor,
			)),
			cron.WithChain(cron.SkipIfStillRunning(cron.DefaultLogger)),
		),
		repo:    repo,
		engine:  engine,
		entries: make(map[int64]cron.EntryID),
		ctx:     ctx,
		cancel:  cancel,
		logger: log.With().
			Str("component", "cron_trigger").
			Logger(),
	}
}

// Start loads all enabled schedule-triggered automations from the database
// and registers them with the scheduler. Registration is best-effort:
// invalid automations are logged and skipped rather than aborting startup.
func (t *CronTrigger) Start(ctx context.Context) error {
	automations, err := t.repo.LoadEnabledScheduleTriggers(ctx)
	if err != nil {
		return fmt.Errorf("load cron automations: %w", err)
	}

	for _, ca := range automations {
		if err := t.Register(ca); err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", ca.Automation.ID).
				Str("automation", ca.Automation.Name).
				Msg("skipping invalid cron automation")
		}
	}

	t.scheduler.Start()
	t.logger.Info().
		Int("registered", len(t.entries)).
		Int("total", len(automations)).
		Msg("cron trigger started")
	return nil
}

// Stop gracefully shuts down the cron scheduler and cancels the lifecycle context.
func (t *CronTrigger) Stop() {
	t.cancel()
	stopCtx := t.scheduler.Stop()
	<-stopCtx.Done()
	t.logger.Info().Msg("cron trigger stopped")
}

// Register adds a hydrated automation to the scheduler and rejects empty,
// invalid, or unknown-timezone schedules.
func (t *CronTrigger) Register(ca CronAutomation) error {
	if ca.Trigger.CronExpr == "" {
		return fmt.Errorf("cron_expr is required")
	}

	loc, err := loadTimezone(ca.Trigger.Timezone)
	if err != nil {
		return fmt.Errorf("load timezone %q: %w", ca.Trigger.Timezone, err)
	}

	// Prefix the cron expression with CRON_TZ for timezone support.
	spec := fmt.Sprintf("CRON_TZ=%s %s", loc.String(), ca.Trigger.CronExpr)

	automationID := ca.Automation.ID
	automationName := ca.Automation.Name
	cronExpr := ca.Trigger.CronExpr

	entryID, err := t.scheduler.AddFunc(spec, func() {
		t.fire(automationID, automationName, cronExpr)
	})
	if err != nil {
		return fmt.Errorf("register cron schedule %q: %w", spec, err)
	}

	t.mu.Lock()
	// Replace any existing schedule for this automation.
	if oldID, exists := t.entries[automationID]; exists {
		t.scheduler.Remove(oldID)
	}
	t.entries[automationID] = entryID
	t.mu.Unlock()

	t.logger.Info().
		Int64("automation_id", automationID).
		Str("automation", automationName).
		Str("cron_expr", cronExpr).
		Str("timezone", loc.String()).
		Msg("registered cron automation")

	return nil
}

// Unregister removes an automation from the cron scheduler.
func (t *CronTrigger) Unregister(automationID int64) {
	t.mu.Lock()
	entryID, exists := t.entries[automationID]
	if exists {
		t.scheduler.Remove(entryID)
		delete(t.entries, automationID)
	}
	t.mu.Unlock()

	if exists {
		t.logger.Info().
			Int64("automation_id", automationID).
			Msg("unregistered cron automation")
	}
}

// Reload re-reads all enabled schedule-triggered automations from the
// database and replaces the current schedule. Uses best-effort registration.
func (t *CronTrigger) Reload(ctx context.Context) error {
	automations, err := t.repo.LoadEnabledScheduleTriggers(ctx)
	if err != nil {
		return fmt.Errorf("reload cron automations: %w", err)
	}

	// Clear stale schedules before re-registering current database state.
	t.mu.Lock()
	for id, entryID := range t.entries {
		t.scheduler.Remove(entryID)
		delete(t.entries, id)
	}
	t.mu.Unlock()

	for _, ca := range automations {
		if err := t.Register(ca); err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", ca.Automation.ID).
				Str("automation", ca.Automation.Name).
				Msg("skipping invalid cron automation on reload")
		}
	}

	t.logger.Info().
		Int("registered", len(t.entries)).
		Int("total", len(automations)).
		Msg("cron trigger reloaded")
	return nil
}

// RegisteredCount returns the number of currently registered cron automations.
func (t *CronTrigger) RegisteredCount() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.entries)
}

// IsRegistered checks whether an automation is currently scheduled.
func (t *CronTrigger) IsRegistered(automationID int64) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, exists := t.entries[automationID]
	return exists
}

// fire is the callback invoked by the cron scheduler when a job triggers.
func (t *CronTrigger) fire(automationID int64, automationName, cronExpr string) {
	firedAt := time.Now().UTC()

	snapshot, err := json.Marshal(cronSnapshot{
		FiredAt:  firedAt.Format(time.RFC3339),
		CronExpr: cronExpr,
	})
	if err != nil {
		t.logger.Error().Err(err).
			Int64("automation_id", automationID).
			Msg("failed to marshal trigger snapshot")
		return
	}

	t.logger.Info().
		Int64("automation_id", automationID).
		Str("automation", automationName).
		Str("cron_expr", cronExpr).
		Msg("cron trigger fired")

	if evalErr := t.engine.Evaluate(t.ctx, automationID, snapshot); evalErr != nil {
		t.logger.Error().Err(evalErr).
			Int64("automation_id", automationID).
			Str("automation", automationName).
			Msg("automation evaluation failed")
	}
}

// loadTimezone loads an IANA timezone. Falls back to UTC for empty strings.
func loadTimezone(tz string) (*time.Location, error) {
	if tz == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(tz)
}
