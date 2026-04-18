package action

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ActionExecutor is the interface that individual action types (command, wait,
// notify, set_variable, etc.) must implement.
type ActionExecutor interface {
	Execute(ctx context.Context, vehicleID *int64, config json.RawMessage) (json.RawMessage, error)
}

// ActionConfig represents a single action step in a chain.
// Type is extracted from the raw JSON; Raw holds the full JSON object
// for the executor to parse action-specific fields.
type ActionConfig struct {
	Type string          `json:"type"`
	Raw  json.RawMessage `json:"-"`
}

// ActionResult captures the outcome of a single action execution within a chain.
type ActionResult struct {
	Index      int             `json:"index"`
	ActionType string          `json:"action_type"`
	Config     json.RawMessage `json:"action_config"`
	Success    bool            `json:"success"`
	Error      string          `json:"error,omitempty"`
	Skipped    bool            `json:"skipped,omitempty"`
	SkipReason string          `json:"skip_reason,omitempty"`
	DurationMs int64           `json:"duration_ms"`
	Output     json.RawMessage `json:"output,omitempty"`
}

// VehicleChainResult groups the chain results for a single vehicle
// during fleet-wide execution.
type VehicleChainResult struct {
	VehicleID   int64          `json:"vehicle_id"`
	VehicleName string         `json:"vehicle_name"`
	Results     []ActionResult `json:"results"`
	Success     bool           `json:"success"`
}

// ChainExecutor runs an ordered list of actions sequentially, dispatching
// each to the appropriate ActionExecutor by type. If stopOnFailure is true,
// execution stops on the first failed action and remaining actions are
// marked as skipped.
type ChainExecutor struct {
	executors   map[string]ActionExecutor
	vehicleRepo VehicleRepo
	logger      zerolog.Logger
}

// NewChainExecutor creates a ChainExecutor with the given vehicle repository.
// Register action executors with Register before calling Execute.
func NewChainExecutor(vehicleRepo VehicleRepo) *ChainExecutor {
	return &ChainExecutor{
		executors:   make(map[string]ActionExecutor),
		vehicleRepo: vehicleRepo,
		logger: log.With().
			Str("component", "chain_executor").
			Logger(),
	}
}

// Register adds an executor for the given action type.
// Calling Register with a type that already exists replaces the previous executor.
func (c *ChainExecutor) Register(actionType string, executor ActionExecutor) {
	c.executors[actionType] = executor
}

// Validate checks that every action in the list has a registered executor.
// Call this before Execute to catch misconfiguration early.
func (c *ChainExecutor) Validate(actions []ActionConfig) error {
	for i, a := range actions {
		if _, ok := c.executors[a.Type]; !ok {
			return fmt.Errorf("action %d: unknown action type %q", i, a.Type)
		}
	}
	return nil
}

// ParseActions unmarshals the raw JSON actions array from an Automation
// into individual ActionConfig entries. Empty or missing type fields are
// normalized to "command" for backward compatibility.
func ParseActions(raw json.RawMessage) ([]ActionConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("actions config is empty")
	}

	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("actions must be a JSON array: %w", err)
	}

	if len(items) == 0 {
		return []ActionConfig{}, nil
	}

	configs := make([]ActionConfig, len(items))
	for i, item := range items {
		var peek struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(item, &peek); err != nil {
			return nil, fmt.Errorf("action %d: invalid JSON: %w", i, err)
		}

		// Normalize empty type to "command" for backward compatibility
		// with existing automations that omit the type field.
		actionType := peek.Type
		if actionType == "" {
			actionType = "command"
		}

		configs[i] = ActionConfig{
			Type: actionType,
			Raw:  item,
		}
	}

	return configs, nil
}

// Execute runs each action in sequence for a single vehicle context.
// If vehicle is non-nil, its ID is passed to each executor.
// If vehicle is nil, nil is passed (the executor decides how to handle it).
//
// When stopOnFailure is true, remaining actions after a failure are marked
// as skipped. The method always returns one ActionResult per action.
func (c *ChainExecutor) Execute(
	ctx context.Context,
	actions []ActionConfig,
	vehicle *models.Vehicle,
	stopOnFailure bool,
) []ActionResult {
	results := make([]ActionResult, 0, len(actions))

	var vehicleID *int64
	if vehicle != nil {
		vehicleID = &vehicle.ID
	}

	stopped := false

	for i, action := range actions {
		// Check context cancellation between actions.
		if ctx.Err() != nil {
			results = append(results, ActionResult{
				Index:      i,
				ActionType: action.Type,
				Config:     action.Raw,
				Skipped:    true,
				SkipReason: fmt.Sprintf("context cancelled: %v", ctx.Err()),
			})
			continue
		}

		// Skip remaining actions after a failure when stopOnFailure is set.
		if stopped {
			results = append(results, ActionResult{
				Index:      i,
				ActionType: action.Type,
				Config:     action.Raw,
				Skipped:    true,
				SkipReason: "previous action failed (stop_on_failure)",
			})
			continue
		}

		executor, ok := c.executors[action.Type]
		if !ok {
			result := ActionResult{
				Index:      i,
				ActionType: action.Type,
				Config:     action.Raw,
				Error:      fmt.Sprintf("unknown action type %q", action.Type),
			}
			results = append(results, result)

			c.logger.Error().
				Int("index", i).
				Str("action_type", action.Type).
				Msg("unknown action type in chain")

			if stopOnFailure {
				stopped = true
			}
			continue
		}

		start := time.Now()
		output, err := executor.Execute(ctx, vehicleID, action.Raw)
		durationMs := time.Since(start).Milliseconds()

		result := ActionResult{
			Index:      i,
			ActionType: action.Type,
			Config:     action.Raw,
			DurationMs: durationMs,
			Output:     output,
		}

		if err != nil {
			result.Error = err.Error()

			c.logger.Warn().
				Err(err).
				Int("index", i).
				Str("action_type", action.Type).
				Int64("duration_ms", durationMs).
				Msg("chain action failed")

			if stopOnFailure {
				stopped = true
			}
		} else {
			result.Success = true

			c.logger.Debug().
				Int("index", i).
				Str("action_type", action.Type).
				Int64("duration_ms", durationMs).
				Msg("chain action succeeded")
		}

		results = append(results, result)
	}

	return results
}

// ExecuteFleet runs the full action chain per vehicle for fleet-wide automations.
// Each vehicle gets its own independent chain execution.
// Returns an error only for infrastructure failures (e.g., cannot list vehicles).
func (c *ChainExecutor) ExecuteFleet(
	ctx context.Context,
	actions []ActionConfig,
	stopOnFailure bool,
) ([]VehicleChainResult, error) {
	vehicles, err := c.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("list vehicles for fleet-wide chain: %w", err)
	}
	if len(vehicles) == 0 {
		return nil, fmt.Errorf("no vehicles found for fleet-wide chain")
	}

	results := make([]VehicleChainResult, 0, len(vehicles))

	for _, v := range vehicles {
		if ctx.Err() != nil {
			return results, fmt.Errorf("context cancelled during fleet chain: %w", ctx.Err())
		}

		c.logger.Info().
			Int64("vehicle_id", v.ID).
			Str("vehicle_name", v.DisplayName).
			Int("action_count", len(actions)).
			Msg("executing chain for vehicle")

		chainResults := c.Execute(ctx, actions, v, stopOnFailure)

		allSuccess := true
		for _, r := range chainResults {
			if !r.Success && !r.Skipped {
				allSuccess = false
				break
			}
		}

		results = append(results, VehicleChainResult{
			VehicleID:   v.ID,
			VehicleName: v.DisplayName,
			Results:     chainResults,
			Success:     allSuccess,
		})
	}

	return results, nil
}

// Succeeded returns the count of successful actions in the results.
func Succeeded(results []ActionResult) int {
	n := 0
	for _, r := range results {
		if r.Success {
			n++
		}
	}
	return n
}

// Failed returns the count of failed (non-skipped) actions in the results.
func Failed(results []ActionResult) int {
	n := 0
	for _, r := range results {
		if !r.Success && !r.Skipped {
			n++
		}
	}
	return n
}

// SkippedCount returns the count of skipped actions in the results.
func SkippedCount(results []ActionResult) int {
	n := 0
	for _, r := range results {
		if r.Skipped {
			n++
		}
	}
	return n
}
