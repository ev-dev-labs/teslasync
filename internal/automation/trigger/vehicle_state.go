package trigger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// VehicleStateRepo is the subset of database.AutomationRepo needed by VehicleStateTrigger.
type VehicleStateRepo interface {
	GetEnabledByVehicleAndTrigger(ctx context.Context, vehicleID int64, triggerType string) ([]*models.AutomationFull, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// VehicleStateConfig represents the parsed trigger_config for vehicle_state automations.
type VehicleStateConfig struct {
	Event     string  `json:"event"`      // required: one of the supported event names
	FromState *string `json:"from_state"` // optional: only fire if transitioning FROM this state
	ToState   *string `json:"to_state"`   // optional: only fire if transitioning TO this state
}

// vehicleStateSnapshot is the JSON payload passed to engine.Evaluate when a vehicle state trigger fires.
type vehicleStateSnapshot struct {
	VehicleID int64  `json:"vehicle_id"`
	Event     string `json:"event"`
	FSMType   string `json:"fsm_type"`
	FromState string `json:"from_state"`
	ToState   string `json:"to_state"`
}

// eventMatcher defines the FSM transition pattern that corresponds to a named event.
// Empty fields act as wildcards (match any value).
type eventMatcher struct {
	fsmType   string // "vehicle", "drive_session", "charge_session"; empty = any
	fromState string // empty = wildcard
	toState   string // empty = wildcard
}

// supportedEvents maps event names to their FSM transition patterns.
// Vehicle-level events match the vehicle FSM (fsmType="vehicle").
// Session-level events match drive/charge sub-FSMs.
var supportedEvents = map[string]eventMatcher{
	"wakes_up":          {fsmType: "vehicle", fromState: enums.StateAsleep, toState: enums.StateOnline},
	"goes_to_sleep":     {fsmType: "vehicle", toState: enums.StateAsleep},
	"comes_online":      {fsmType: "vehicle", fromState: enums.StateOffline, toState: enums.StateOnline},
	"goes_offline":      {fsmType: "vehicle", toState: enums.StateOffline},
	"drive_starts":      {fsmType: "drive_session", fromState: "pending", toState: "active"},
	"drive_ends":        {fsmType: "drive_session", toState: "completed"},
	"charging_starts":   {fsmType: "charge_session", fromState: "pending", toState: "active"},
	"charging_stops":    {fsmType: "charge_session", fromState: "active"},
	"charging_complete": {fsmType: "charge_session", toState: "done"},
	"sentry_event":     {fsmType: "vehicle"}, // sentry mode event (any vehicle transition while sentry active)
	"state_change":     {},                   // matches any FSM transition
}

// VehicleStateTrigger evaluates vehicle-state-based automations when FSM transitions occur.
type VehicleStateTrigger struct {
	repo   VehicleStateRepo
	engine AutomationEngine
	logger zerolog.Logger
}

// NewVehicleStateTrigger creates a new vehicle state trigger evaluator.
func NewVehicleStateTrigger(repo VehicleStateRepo, engine AutomationEngine) *VehicleStateTrigger {
	return &VehicleStateTrigger{
		repo:   repo,
		engine: engine,
		logger: log.With().
			Str("component", "vehicle_state_trigger").
			Logger(),
	}
}

// OnFSMTransition is called whenever any FSM transition occurs.
// It checks all vehicle_state automations for the given vehicle to see if any should fire.
// fsmType is one of "vehicle", "drive_session", or "charge_session".
func (t *VehicleStateTrigger) OnFSMTransition(ctx context.Context, vehicleID int64, fsmType, fromState, toState string) error {
	automations, err := t.repo.GetEnabledByVehicleAndTrigger(ctx, vehicleID, "vehicle_state")
	if err != nil {
		return fmt.Errorf("load vehicle_state automations for vehicle %d: %w", vehicleID, err)
	}

	if len(automations) == 0 {
		return nil
	}

	var firstErr error
	for _, a := range automations {
		cfg, err := parseVehicleStateConfig(a.TriggerConfig())
		if err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("invalid vehicle_state trigger config, auto-disabling")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid vehicle_state config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation")
			}
			continue
		}

		if !matchesEvent(cfg.Event, cfg.FromState, cfg.ToState, fsmType, fromState, toState) {
			continue
		}

		snapshot, err := json.Marshal(vehicleStateSnapshot{
			VehicleID: vehicleID,
			Event:     cfg.Event,
			FSMType:   fsmType,
			FromState: fromState,
			ToState:   toState,
		})
		if err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", a.ID).
				Msg("failed to marshal vehicle_state trigger snapshot")
			continue
		}

		t.logger.Info().
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Int64("vehicle_id", vehicleID).
			Str("event", cfg.Event).
			Str("fsm_type", fsmType).
			Str("from_state", fromState).
			Str("to_state", toState).
			Msg("vehicle_state trigger fired")

		if evalErr := t.engine.Evaluate(ctx, a.ID, snapshot); evalErr != nil {
			t.logger.Error().Err(evalErr).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("automation evaluation failed")
			if firstErr == nil {
				firstErr = fmt.Errorf("evaluate automation %d: %w", a.ID, evalErr)
			}
		}
	}

	return firstErr
}

// matchesEvent determines whether a transition (fsmType, fromState, toState) matches
// a configured event with optional user-defined from/to state filters.
func matchesEvent(event string, fromFilter, toFilter *string, fsmType, fromState, toState string) bool {
	matcher, ok := supportedEvents[event]
	if !ok {
		return false
	}

	// Check fsmType matches (empty matcher = wildcard).
	if matcher.fsmType != "" && matcher.fsmType != fsmType {
		return false
	}

	// Check fromState matches the event's pattern.
	if matcher.fromState != "" && matcher.fromState != fromState {
		return false
	}

	// Check toState matches the event's pattern.
	if matcher.toState != "" && matcher.toState != toState {
		return false
	}

	// Apply user-defined from_state filter (optional, further narrows the match).
	if fromFilter != nil && *fromFilter != fromState {
		return false
	}

	// Apply user-defined to_state filter (optional, further narrows the match).
	if toFilter != nil && *toFilter != toState {
		return false
	}

	return true
}

// parseVehicleStateConfig unmarshals and validates the trigger_config JSON.
func parseVehicleStateConfig(raw json.RawMessage) (*VehicleStateConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg VehicleStateConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	if cfg.Event == "" {
		return nil, fmt.Errorf("event is required")
	}

	if _, ok := supportedEvents[cfg.Event]; !ok {
		return nil, fmt.Errorf("unsupported event %q", cfg.Event)
	}

	return &cfg, nil
}
