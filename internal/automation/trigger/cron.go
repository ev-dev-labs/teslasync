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

// CronRepo is the subset of database.AutomationRepo needed by CronTrigger.
type CronRepo interface {
	GetByTriggerType(ctx context.Context, triggerType string) ([]*models.Automation, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// CronConfig represents the parsed trigger_config for cron automations.
type CronConfig struct {
	CronExpr    string `json:"cron_expr"`
	Timezone    string `json:"timezone"`
	OneTime     bool   `json:"one_time"`
	OneTimeDate string `json:"one_time_date"`
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

// Start loads all enabled cron automations from the database and registers
// them with the scheduler. Registration is best-effort: invalid automations
// are auto-disabled and skipped rather than aborting startup.
func (t *CronTrigger) Start(ctx context.Context) error {
	automations, err := t.repo.GetByTriggerType(ctx, "cron")
	if err != nil {
		return fmt.Errorf("load cron automations: %w", err)
	}

	for _, a := range automations {
		if err := t.Register(a); err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("skipping invalid cron automation")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid cron config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation")
			}
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

// Register adds a single automation to the cron scheduler.
// Returns an error if the trigger config is malformed, has an invalid
// cron expression, or specifies an unknown timezone.
func (t *CronTrigger) Register(automation *models.Automation) error {
	cfg, err := parseCronConfig(automation.TriggerConfig)
	if err != nil {
		return fmt.Errorf("parse trigger config: %w", err)
	}

	if cfg.CronExpr == "" {
		return fmt.Errorf("cron_expr is required")
	}

	loc, err := loadTimezone(cfg.Timezone)
	if err != nil {
		return fmt.Errorf("load timezone %q: %w", cfg.Timezone, err)
	}

	// For one-time triggers with a specific date, check if the date has passed.
	if cfg.OneTime && cfg.OneTimeDate != "" {
		if pastDate, reason := isOneTimeDatePast(cfg.OneTimeDate, loc); pastDate {
			return fmt.Errorf("one-time date expired: %s", reason)
		}
	}

	// Prefix the cron expression with CRON_TZ for timezone support.
	spec := fmt.Sprintf("CRON_TZ=%s %s", loc.String(), cfg.CronExpr)

	automationID := automation.ID
	automationName := automation.Name
	isOneTime := cfg.OneTime
	cronExpr := cfg.CronExpr

	entryID, err := t.scheduler.AddFunc(spec, func() {
		t.fire(automationID, automationName, cronExpr, isOneTime)
	})
	if err != nil {
		return fmt.Errorf("register cron schedule %q: %w", spec, err)
	}

	t.mu.Lock()
	// If already registered, remove the old entry first.
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
		Bool("one_time", isOneTime).
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

// Reload re-reads all enabled cron automations from the database and
// replaces the current schedule. Uses best-effort registration.
func (t *CronTrigger) Reload(ctx context.Context) error {
	automations, err := t.repo.GetByTriggerType(ctx, "cron")
	if err != nil {
		return fmt.Errorf("reload cron automations: %w", err)
	}

	// Remove all current entries.
	t.mu.Lock()
	for id, entryID := range t.entries {
		t.scheduler.Remove(entryID)
		delete(t.entries, id)
	}
	t.mu.Unlock()

	// Re-register all.
	for _, a := range automations {
		if err := t.Register(a); err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("skipping invalid cron automation on reload")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid cron config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation on reload")
			}
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
func (t *CronTrigger) fire(automationID int64, automationName, cronExpr string, oneTime bool) {
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
		Bool("one_time", oneTime).
		Msg("cron trigger fired")

	// For one-time triggers, unregister and disable before evaluation
	// to guarantee at-most-once semantics regardless of evaluation outcome.
	if oneTime {
		t.Unregister(automationID)
		if disableErr := t.repo.SetAutoDisabled(t.ctx, automationID, "one-time cron trigger executed"); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", automationID).
				Msg("failed to auto-disable one-time automation")
		}
	}

	if evalErr := t.engine.Evaluate(t.ctx, automationID, snapshot); evalErr != nil {
		t.logger.Error().Err(evalErr).
			Int64("automation_id", automationID).
			Str("automation", automationName).
			Msg("automation evaluation failed")
	}
}

// parseCronConfig unmarshals the trigger_config JSON into a CronConfig.
func parseCronConfig(raw json.RawMessage) (*CronConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg CronConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}
	return &cfg, nil
}

// loadTimezone loads an IANA timezone. Falls back to UTC for empty strings.
func loadTimezone(tz string) (*time.Location, error) {
	if tz == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(tz)
}

// isOneTimeDatePast checks whether a one_time_date (YYYY-MM-DD) has already
// passed in the given timezone. Returns true with a reason if expired.
func isOneTimeDatePast(dateStr string, loc *time.Location) (bool, string) {
	targetDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return true, fmt.Sprintf("invalid date format %q: %v", dateStr, err)
	}

	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	target := time.Date(targetDate.Year(), targetDate.Month(), targetDate.Day(), 0, 0, 0, 0, loc)

	if target.Before(today) {
		return true, fmt.Sprintf("target date %s is before today %s", dateStr, today.Format("2006-01-02"))
	}
	return false, ""
}
