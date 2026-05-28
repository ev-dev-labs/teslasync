// Package action implements automation action executors.
// Actions are the "do" step of trigger → condition → action automation rules.
package action

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleRepo is the subset of vehicledb.VehicleRepo needed by CommandExecutor.
type VehicleRepo interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
}

type VehicleStateProvider interface {
	GetLiveState(ctx context.Context, id int64) (string, error)
}

// CommandLogRepo is the subset of energydb.CommandLogRepo needed by CommandExecutor.
type CommandLogRepo interface {
	Create(ctx context.Context, cl *vehiclemodel.CommandLog) error
}

// SettingsChecker provides safety-gate checks before command execution.
type SettingsChecker interface {
	IsAPISuspended(ctx context.Context) (bool, error)
	GetPollingConfig(ctx context.Context) (*systemmodel.PollingConfig, error)
}

// TeslaCommander abstracts the Tesla client for testability.
type TeslaCommander interface {
	HasValidToken() bool
	WakeUp(ctx context.Context, vin string) error
	SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error
}

// CommandConfig represents the parsed action config for command actions.
type CommandConfig struct {
	Type    string                 `json:"type"`    // "command" or empty
	Command string                 `json:"command"` // e.g. "climate_on", "lock"
	Params  map[string]interface{} `json:"params"`  // optional command parameters
}

// WakeResult captures the outcome of an auto-wake attempt before command execution.
type WakeResult struct {
	Attempted  bool   `json:"attempted"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	PollCount  int    `json:"poll_count"`
}

// CommandResult captures the outcome of a single vehicle command execution.
type CommandResult struct {
	VehicleID   int64       `json:"vehicle_id"`
	VehicleName string      `json:"vehicle_name"`
	Command     string      `json:"command"`
	Success     bool        `json:"success"`
	Error       string      `json:"error,omitempty"`
	DurationMs  int64       `json:"duration_ms"`
	WakeResult  *WakeResult `json:"wake_result,omitempty"`
}

// CommandExecutor sends Tesla vehicle commands as an automation action.
type CommandExecutor struct {
	vehicleRepo  VehicleRepo
	commandRepo  CommandLogRepo
	settingsRepo SettingsChecker
	teslaClient  TeslaCommander
	logger       zerolog.Logger

	// Overridable for testing.
	wakeTimeout      time.Duration
	wakePollInterval time.Duration
}

// Default wake timing constants.
const (
	defaultWakeTimeout      = 30 * time.Second
	defaultWakePollInterval = 5 * time.Second
)

// NewCommandExecutor creates a command action executor.
func NewCommandExecutor(
	vehicleRepo VehicleRepo,
	commandRepo CommandLogRepo,
	settingsRepo SettingsChecker,
	teslaClient TeslaCommander,
) *CommandExecutor {
	return &CommandExecutor{
		vehicleRepo:      vehicleRepo,
		commandRepo:      commandRepo,
		settingsRepo:     settingsRepo,
		teslaClient:      teslaClient,
		wakeTimeout:      defaultWakeTimeout,
		wakePollInterval: defaultWakePollInterval,
		logger: log.With().
			Str("component", "command_action").
			Logger(),
	}
}

// DecodeCommandSpec unmarshals and validates a command action config.
// Rejects unknown commands at parse time to prevent recurring failures.
func DecodeCommandSpec(raw json.RawMessage) (*CommandConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("action config is empty")
	}

	var cfg CommandConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal command action config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "command" {
		return nil, fmt.Errorf("expected type \"command\", got %q", cfg.Type)
	}

	if cfg.Command == "" {
		return nil, fmt.Errorf("command is required")
	}

	if !tesla.IsKnownCommand(cfg.Command) {
		return nil, fmt.Errorf("unknown command %q", cfg.Command)
	}

	return &cfg, nil
}

var ParseCommandConfig = DecodeCommandSpec

// Execute runs the command action for the given automation context.
// If vehicleID is non-nil, the command targets that single vehicle.
// If vehicleID is nil (fleet-wide automation), the command is sent to all vehicles.
// Returns a JSON array of CommandResult and a summary error (nil if all succeeded).
func (e *CommandExecutor) Execute(ctx context.Context, vehicleID *int64, raw json.RawMessage) (json.RawMessage, error) {
	cfg, err := DecodeCommandSpec(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid command action config: %w", err)
	}
	return e.executeCommandConfig(ctx, vehicleID, cfg)
}

// ExecuteTyped runs an action_command CTI child without decoding legacy action
// wrappers. CommandParams remains the sole schema-on-read JSON carve-out.
func (e *CommandExecutor) ExecuteTyped(ctx context.Context, vehicleID *int64, payload any) (json.RawMessage, error) {
	action, ok := payload.(*models.AutomationAction)
	if !ok {
		return nil, fmt.Errorf("command action payload type %T is not *models.AutomationAction", payload)
	}
	params := map[string]interface{}{}
	if len(action.CommandParams) > 0 && string(action.CommandParams) != "null" {
		if err := json.Unmarshal(action.CommandParams, &params); err != nil {
			return nil, fmt.Errorf("decode command_params: %w", err)
		}
	}
	cfg := &CommandConfig{
		Type:    "command",
		Command: action.CommandName,
		Params:  params,
	}
	if cfg.Command == "" {
		return nil, fmt.Errorf("command_name is required")
	}
	if !tesla.IsKnownCommand(cfg.Command) {
		return nil, fmt.Errorf("unknown command %q", cfg.Command)
	}
	return e.executeCommandConfig(ctx, vehicleID, cfg)
}

func (e *CommandExecutor) executeCommandConfig(ctx context.Context, vehicleID *int64, cfg *CommandConfig) (json.RawMessage, error) {
	// Safety gate: respect global API suspension.
	if suspended, err := e.settingsRepo.IsAPISuspended(ctx); err != nil {
		return nil, fmt.Errorf("check API suspension: %w", err)
	} else if suspended {
		return nil, fmt.Errorf("Tesla API calls are suspended")
	}

	if !e.teslaClient.HasValidToken() {
		return nil, fmt.Errorf("not authenticated with Tesla")
	}

	pollingCfg, err := e.settingsRepo.GetPollingConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("get polling config: %w", err)
	}

	var vehicles []*vehiclemodel.Vehicle
	if vehicleID != nil {
		v, err := e.vehicleRepo.GetByID(ctx, *vehicleID)
		if err != nil {
			return nil, fmt.Errorf("look up vehicle %d: %w", *vehicleID, err)
		}
		if v == nil {
			if pollingCfg != nil && !pollingCfg.Enabled {
				return nil, fmt.Errorf("wake_up endpoint is disabled")
			}
			return nil, fmt.Errorf("vehicle %d not found", *vehicleID)
		}
		vehicles = []*vehiclemodel.Vehicle{v}
	} else {
		all, err := e.vehicleRepo.GetAll(ctx)
		if err != nil {
			return nil, fmt.Errorf("list vehicles for fleet-wide command: %w", err)
		}
		if len(all) == 0 {
			return nil, fmt.Errorf("no vehicles found for fleet-wide command")
		}
		vehicles = all
	}

	results := make([]CommandResult, 0, len(vehicles))
	var failures int

	for _, v := range vehicles {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("context cancelled during fleet command execution: %w", ctx.Err())
		}

		result := e.sendToVehicle(ctx, v, cfg)
		results = append(results, result)
		if !result.Success {
			failures++
		}
	}

	resultJSON, err := json.Marshal(results)
	if err != nil {
		return nil, fmt.Errorf("marshal command results: %w", err)
	}

	if failures > 0 {
		return resultJSON, fmt.Errorf("%d of %d vehicle commands failed", failures, len(vehicles))
	}

	return resultJSON, nil
}

// sendToVehicle sends a single command to one vehicle, logs it, and returns the result.
// If the vehicle is asleep or offline it automatically attempts to wake it first.
func (e *CommandExecutor) sendToVehicle(ctx context.Context, v *vehiclemodel.Vehicle, cfg *CommandConfig) CommandResult {
	start := time.Now()

	result := CommandResult{
		VehicleID:   v.ID,
		VehicleName: v.DisplayName,
		Command:     cfg.Command,
	}

	// Auto-wake: if the vehicle is not online and the command isn't wake_up itself.
	if cfg.Command != "wake_up" {
		wr := e.wakeIfNeeded(ctx, v)
		if wr != nil {
			result.WakeResult = wr
			if !wr.Success {
				result.DurationMs = time.Since(start).Milliseconds()
				result.Error = fmt.Sprintf("auto-wake failed: %s", wr.Error)
				e.logCommand(ctx, v, cfg, "failed", result.Error)
				return result
			}
		}
	}

	cmdErr := e.teslaClient.SendCommand(ctx, v.VIN, cfg.Command, cfg.Params)
	result.DurationMs = time.Since(start).Milliseconds()

	status := "success"
	errMsg := ""
	if cmdErr != nil {
		status = "failed"
		errMsg = cmdErr.Error()
		result.Error = errMsg
	} else {
		result.Success = true
	}

	e.logCommand(ctx, v, cfg, status, errMsg)

	e.logger.Info().
		Int64("vehicle_id", v.ID).
		Str("vehicle_name", v.DisplayName).
		Str("command", cfg.Command).
		Str("status", status).
		Int64("duration_ms", result.DurationMs).
		Msg("automation command executed")

	return result
}

// wakeIfNeeded sends an auto-wake command before dispatching a vehicle command.
func (e *CommandExecutor) wakeIfNeeded(ctx context.Context, v *vehiclemodel.Vehicle) *WakeResult {
	state, err := e.currentVehicleState(ctx, v)
	if err != nil {
		return &WakeResult{
			Attempted: true,
			Error:     fmt.Sprintf("read vehicle live state: %v", err),
		}
	}
	if state == "online" {
		return nil
	}

	wr := &WakeResult{Attempted: true}
	start := time.Now()

	pollingCfg, err := e.settingsRepo.GetPollingConfig(ctx)
	if err != nil {
		wr.Error = fmt.Sprintf("get polling config: %v", err)
		wr.DurationMs = time.Since(start).Milliseconds()
		return wr
	}
	if pollingCfg != nil && !pollingCfg.Enabled {
		wr.Error = "wake_up endpoint is disabled"
		wr.DurationMs = time.Since(start).Milliseconds()
		return wr
	}

	e.logger.Info().
		Int64("vehicle_id", v.ID).
		Str("vehicle_name", v.DisplayName).
		Msg("attempting auto-wake before command")

	if err := e.teslaClient.WakeUp(ctx, v.VIN); err != nil {
		wr.Error = fmt.Sprintf("wake command failed: %v", err)
		wr.DurationMs = time.Since(start).Milliseconds()
		return wr
	}

	timer := time.NewTimer(e.wakeTimeout)
	defer timer.Stop()
	ticker := time.NewTicker(e.wakePollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			wr.Error = ctx.Err().Error()
			wr.DurationMs = time.Since(start).Milliseconds()
			return wr
		case <-timer.C:
			wr.Error = "vehicle did not wake up within timeout"
			wr.DurationMs = time.Since(start).Milliseconds()
			return wr
		case <-ticker.C:
			wr.PollCount++
			state, err := e.currentVehicleState(ctx, v)
			if err != nil {
				continue
			}
			if state == "online" {
				wr.Success = true
				wr.DurationMs = time.Since(start).Milliseconds()

				e.logger.Info().
					Int64("vehicle_id", v.ID).
					Int64("duration_ms", wr.DurationMs).
					Int("poll_count", wr.PollCount).
					Msg("auto-wake completed successfully")

				return wr
			}
		}
	}
}

func (e *CommandExecutor) currentVehicleState(ctx context.Context, v *vehiclemodel.Vehicle) (string, error) {
	if v == nil {
		return "", nil
	}
	provider, ok := e.vehicleRepo.(VehicleStateProvider)
	if !ok {
		return "", nil
	}
	state, err := provider.GetLiveState(ctx, v.ID)
	if err != nil {
		return "", err
	}
	return strings.ToLower(strings.TrimSpace(state)), nil
}

// logCommand writes a command_logs row for audit. Errors are logged but not propagated.
func (e *CommandExecutor) logCommand(ctx context.Context, v *vehiclemodel.Vehicle, cfg *CommandConfig, status, errMsg string) {
	paramsJSON, _ := json.Marshal(cfg.Params)
	cl := &vehiclemodel.CommandLog{
		VehicleID: v.ID,
		Command:   cfg.Command,
		Params:    string(paramsJSON),
		Status:    status,
		Error:     errMsg,
	}
	if logErr := e.commandRepo.Create(ctx, cl); logErr != nil {
		e.logger.Error().Err(logErr).
			Int64("vehicle_id", v.ID).
			Str("command", cfg.Command).
			Msg("failed to log command")
	}
}
