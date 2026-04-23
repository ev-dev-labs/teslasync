// Package trigger implements automation trigger evaluators.
// calendar.go fires automations relative to upcoming calendar events synced to the vehicle.
package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// CalendarRepo is the subset of database.AutomationRepo needed by CalendarTrigger.
type CalendarRepo interface {
	GetByTriggerType(ctx context.Context, triggerType string) ([]*models.AutomationFull, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// CalendarEntry represents a single upcoming calendar event from the vehicle.
type CalendarEntry struct {
	EventID   string    `json:"event_id"`
	Title     string    `json:"title"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Location  string    `json:"location"`
}

// CalendarProvider abstracts fetching upcoming calendar entries for a vehicle.
// Implementations may call the Tesla Fleet API's upcoming_calendar_entries command
// or any other calendar source.
type CalendarProvider interface {
	GetUpcomingCalendarEntries(ctx context.Context, vehicleID int64) ([]CalendarEntry, error)
}

// CalendarConfig represents the parsed trigger_config for calendar automations.
type CalendarConfig struct {
	OffsetMinutes     int     `json:"offset_minutes"`      // negative = before event, positive = after
	EventFilter       *string `json:"event_filter"`        // optional regex to match event title
	LocationRequired  bool    `json:"location_required"`   // only fire if event has a location
	IncludeNavigation bool    `json:"include_navigation"`  // include in snapshot for action layer
}

// calendarSnapshot is the JSON payload passed to engine.Evaluate when a calendar trigger fires.
type calendarSnapshot struct {
	EventTitle        string `json:"event_title"`
	EventStart        string `json:"event_start"`
	EventLocation     string `json:"event_location"`
	FireTime          string `json:"fire_time"`
	OffsetMinutes     int    `json:"offset_minutes"`
	IncludeNavigation bool   `json:"include_navigation"`
}

// CalendarTrigger manages calendar-based automation scheduling. It polls for
// upcoming calendar entries at a configurable interval and fires automations
// whose fire time (event_start + offset) falls within the tick window.
type CalendarTrigger struct {
	mu       sync.Mutex
	repo     CalendarRepo
	engine   AutomationEngine
	calendar CalendarProvider
	ctx      context.Context
	cancel   context.CancelFunc
	logger   zerolog.Logger

	// firedEvents tracks which automation+event combinations have already fired
	// to prevent double-firing. Key: "automationID:fireTimeUTC".
	firedEvents map[string]time.Time

	// lastTick records when the previous tick started. Fire window is (lastTick, now].
	lastTick time.Time

	// ticking prevents overlapping tick executions.
	ticking sync.Mutex

	// Test seams.
	nowFunc      func() time.Time
	pollInterval time.Duration
}

// NewCalendarTrigger creates a new calendar trigger manager.
func NewCalendarTrigger(repo CalendarRepo, calendar CalendarProvider, engine AutomationEngine) *CalendarTrigger {
	ctx, cancel := context.WithCancel(context.Background())
	return &CalendarTrigger{
		repo:         repo,
		calendar:     calendar,
		engine:       engine,
		ctx:          ctx,
		cancel:       cancel,
		firedEvents:  make(map[string]time.Time),
		nowFunc:      func() time.Time { return time.Now().UTC() },
		pollInterval: 15 * time.Minute,
		logger: log.With().
			Str("component", "calendar_trigger").
			Logger(),
	}
}

// Start launches the background polling loop. It returns immediately;
// the loop runs until Stop() or context cancellation.
func (t *CalendarTrigger) Start(ctx context.Context) error {
	now := t.nowFunc()
	t.mu.Lock()
	t.lastTick = now
	t.mu.Unlock()

	// Run an initial tick so automations don't wait a full poll interval on startup.
	t.tick(ctx)

	go func() {
		ticker := time.NewTicker(t.pollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-t.ctx.Done():
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				t.tick(ctx)
			}
		}
	}()

	t.logger.Info().
		Dur("poll_interval", t.pollInterval).
		Msg("calendar trigger started")
	return nil
}

// Stop cancels the background loop.
func (t *CalendarTrigger) Stop() {
	t.cancel()
	t.logger.Info().Msg("calendar trigger stopped")
}

// tick runs one evaluation cycle. It groups automations by vehicle to minimize
// API calls, then evaluates each automation against its vehicle's calendar entries.
func (t *CalendarTrigger) tick(ctx context.Context) {
	// Prevent overlapping ticks from concurrent execution.
	if !t.ticking.TryLock() {
		t.logger.Debug().Msg("skipping calendar tick: previous tick still running")
		return
	}
	defer t.ticking.Unlock()

	now := t.nowFunc()
	t.mu.Lock()
	lastTick := t.lastTick
	t.lastTick = now
	t.mu.Unlock()

	automations, err := t.repo.GetByTriggerType(ctx, "calendar")
	if err != nil {
		t.logger.Error().Err(err).Msg("failed to load calendar automations")
		return
	}

	if len(automations) == 0 {
		return
	}

	// Group automations by vehicleID to fetch entries once per vehicle.
	byVehicle := make(map[int64][]*models.AutomationFull)
	var noVehicle []*models.AutomationFull
	for _, a := range automations {
		if a.VehicleID == nil {
			noVehicle = append(noVehicle, a)
			continue
		}
		byVehicle[*a.VehicleID] = append(byVehicle[*a.VehicleID], a)
	}

	// Auto-disable automations without a vehicle.
	for _, a := range noVehicle {
		t.logger.Warn().
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("calendar automation has no vehicle_id, auto-disabling")
		if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, "calendar trigger requires vehicle_id"); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", a.ID).
				Msg("failed to auto-disable automation")
		}
	}

	// Fetch entries per vehicle and evaluate.
	for vehicleID, vehicleAutomations := range byVehicle {
		entries, err := t.calendar.GetUpcomingCalendarEntries(ctx, vehicleID)
		if err != nil {
			// Transient API errors: log and skip, don't disable.
			t.logger.Warn().Err(err).
				Int64("vehicle_id", vehicleID).
				Msg("failed to fetch calendar entries, skipping vehicle this tick")
			continue
		}

		for _, a := range vehicleAutomations {
			t.evaluateAutomation(ctx, a, entries, lastTick, now)
		}
	}

	// Prune old dedup entries (older than 24 hours).
	t.pruneExpiredEntries(now)
}

// evaluateAutomation checks one automation against its vehicle's calendar entries.
func (t *CalendarTrigger) evaluateAutomation(ctx context.Context, a *models.AutomationFull, entries []CalendarEntry, lastTick, now time.Time) {
	cfg, err := parseCalendarConfig(a.TriggerConfig())
	if err != nil {
		t.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("invalid calendar config, auto-disabling")
		if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid calendar config: %v", err)); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", a.ID).
				Msg("failed to auto-disable invalid automation")
		}
		return
	}

	var filterRe *regexp.Regexp
	if cfg.EventFilter != nil && *cfg.EventFilter != "" {
		filterRe, err = regexp.Compile(*cfg.EventFilter)
		if err != nil {
			// Regex was validated at parse time; this shouldn't happen.
			t.logger.Error().Err(err).
				Int64("automation_id", a.ID).
				Msg("event_filter regex failed to compile (should not happen)")
			return
		}
	}

	offset := time.Duration(cfg.OffsetMinutes) * time.Minute

	for _, entry := range entries {
		// Apply event_filter if configured.
		if filterRe != nil && !filterRe.MatchString(entry.Title) {
			continue
		}

		// Apply location_required filter.
		if cfg.LocationRequired && entry.Location == "" {
			continue
		}

		fireTime := entry.StartTime.Add(offset)

		// Check if fire time falls within (lastTick, now].
		if !inCalendarFireWindow(lastTick, now, fireTime) {
			continue
		}

		// Deduplicate: don't fire the same event occurrence twice.
		dedupKey := calendarDedupKey(a.ID, fireTime)
		t.mu.Lock()
		if _, fired := t.firedEvents[dedupKey]; fired {
			t.mu.Unlock()
			continue
		}
		t.firedEvents[dedupKey] = now
		t.mu.Unlock()

		t.fire(ctx, a, cfg, entry, fireTime)
	}
}

// inCalendarFireWindow checks whether fireTime falls within (lastTick, now].
func inCalendarFireWindow(lastTick, now, fireTime time.Time) bool {
	return fireTime.After(lastTick) && !fireTime.After(now)
}

// calendarDedupKey generates a unique key for deduplication.
func calendarDedupKey(automationID int64, fireTime time.Time) string {
	return fmt.Sprintf("%d:%d", automationID, fireTime.UTC().Unix())
}

// fire marshals the snapshot and calls engine.Evaluate.
func (t *CalendarTrigger) fire(ctx context.Context, a *models.AutomationFull, cfg *CalendarConfig, entry CalendarEntry, fireTime time.Time) {
	snapshot, err := json.Marshal(calendarSnapshot{
		EventTitle:        entry.Title,
		EventStart:        entry.StartTime.Format(time.RFC3339),
		EventLocation:     entry.Location,
		FireTime:          fireTime.Format(time.RFC3339),
		OffsetMinutes:     cfg.OffsetMinutes,
		IncludeNavigation: cfg.IncludeNavigation,
	})
	if err != nil {
		t.logger.Error().Err(err).
			Int64("automation_id", a.ID).
			Msg("failed to marshal calendar trigger snapshot")
		return
	}

	t.logger.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Str("event_title", entry.Title).
		Str("event_start", entry.StartTime.Format(time.RFC3339)).
		Str("event_location", entry.Location).
		Str("fire_time", fireTime.Format(time.RFC3339)).
		Int("offset_minutes", cfg.OffsetMinutes).
		Msg("calendar trigger fired")

	if evalErr := t.engine.Evaluate(ctx, a.ID, snapshot); evalErr != nil {
		t.logger.Error().Err(evalErr).
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("automation evaluation failed")
	}
}

// pruneExpiredEntries removes dedup entries older than 24 hours to prevent unbounded growth.
func (t *CalendarTrigger) pruneExpiredEntries(now time.Time) {
	cutoff := now.Add(-24 * time.Hour)
	t.mu.Lock()
	defer t.mu.Unlock()
	for key, firedAt := range t.firedEvents {
		if firedAt.Before(cutoff) {
			delete(t.firedEvents, key)
		}
	}
}

// parseCalendarConfig unmarshals and validates the trigger_config JSON.
func parseCalendarConfig(raw json.RawMessage) (*CalendarConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}

	var cfg CalendarConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	// Validate offset is reasonable (±24 hours).
	if cfg.OffsetMinutes < -1440 || cfg.OffsetMinutes > 1440 {
		return nil, fmt.Errorf("offset_minutes must be between -1440 and 1440, got %d", cfg.OffsetMinutes)
	}

	// Validate event_filter regex if provided.
	if cfg.EventFilter != nil && *cfg.EventFilter != "" {
		if _, err := regexp.Compile(*cfg.EventFilter); err != nil {
			return nil, fmt.Errorf("invalid event_filter regex %q: %w", *cfg.EventFilter, err)
		}
	}

	return &cfg, nil
}
