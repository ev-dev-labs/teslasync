// Package action implements automation action executors.
// Actions are the "do" step of trigger → condition → action automation rules.
package action

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// VehicleRepo is the subset of database.VehicleRepo needed by CommandExecutor.
type VehicleRepo interface {
	GetByID(ctx context.Context, id int64) (*models.Vehicle, error)
	GetAll(ctx context.Context) ([]*models.Vehicle, error)
}

// CommandLogRepo is the subset of database.CommandLogRepo needed by CommandExecutor.
type CommandLogRepo interface {
	Create(ctx context.Context, cl *models.CommandLog) error
}

// SettingsChecker provides safety-gate checks before command execution.
type SettingsChecker interface {
	IsAPISuspended(ctx context.Context) (bool, error)
	GetPollingConfig(ctx context.Context) (*models.PollingConfig, error)
}

// TeslaCommander abstracts the Tesla client for testability.
type TeslaCommander interface {
	HasValidToken() bool
	SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error
}

// CommandConfig represents the parsed action config for command actions.
type CommandConfig struct {
	Type    string                 `json:"type"`    // "command" or empty
	Command string                 `json:"command"` // e.g. "climate_on", "lock"
	Params  map[string]interface{} `json:"params"`  // optional command parameters
}

// CommandResult captures the outcome of a single vehicle command execution.
type CommandResult struct {
	VehicleID   int64  `json:"vehicle_id"`
	VehicleName string `json:"vehicle_name"`
	Command     string `json:"command"`
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
	DurationMs  int64  `json:"duration_ms"`
}

// CommandExecutor sends Tesla vehicle commands as an automation action.
type CommandExecutor struct {
	vehicleRepo  VehicleRepo
	commandRepo  CommandLogRepo
	settingsRepo SettingsChecker
	teslaClient  TeslaCommander
	logger       zerolog.Logger
}

// NewCommandExecutor creates a command action executor.
func NewCommandExecutor(
	vehicleRepo VehicleRepo,
	commandRepo CommandLogRepo,
	settingsRepo SettingsChecker,
	teslaClient TeslaCommander,
) *CommandExecutor {
	return &CommandExecutor{
		vehicleRepo:  vehicleRepo,
		commandRepo:  commandRepo,
		settingsRepo: settingsRepo,
		teslaClient:  teslaClient,
		logger: log.With().
			Str("component", "command_action").
			Logger(),
	}
}

// ParseCommandConfig unmarshals and validates a command action config.
// Rejects unknown commands at parse time to prevent recurring failures.
func ParseCommandConfig(raw json.RawMessage) (*CommandConfig, error) {
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

// Execute runs the command action for the given automation context.
// If vehicleID is non-nil, the command targets that single vehicle.
// If vehicleID is nil (fleet-wide automation), the command is sent to all vehicles.
// Returns a JSON array of CommandResult and a summary error (nil if all succeeded).
func (e *CommandExecutor) Execute(ctx context.Context, vehicleID *int64, raw json.RawMessage) (json.RawMessage, error) {
	cfg, err := ParseCommandConfig(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid command action config: %w", err)
	}

	// Safety gate: respect global API suspension.
	if suspended, err := e.settingsRepo.IsAPISuspended(ctx); err != nil {
		return nil, fmt.Errorf("check API suspension: %w", err)
	} else if suspended {
		return nil, fmt.Errorf("Tesla API calls are suspended")
	}

	// Safety gate: respect commands polling toggle.
	if pc, err := e.settingsRepo.GetPollingConfig(ctx); err == nil && !pc.Commands {
		return nil, fmt.Errorf("vehicle commands endpoint is disabled in polling config")
	}

	if !e.teslaClient.HasValidToken() {
		return nil, fmt.Errorf("not authenticated with Tesla")
	}

	var vehicles []*models.Vehicle
	if vehicleID != nil {
		v, err := e.vehicleRepo.GetByID(ctx, *vehicleID)
		if err != nil {
			return nil, fmt.Errorf("look up vehicle %d: %w", *vehicleID, err)
		}
		if v == nil {
			return nil, fmt.Errorf("vehicle %d not found", *vehicleID)
		}
		vehicles = []*models.Vehicle{v}
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
func (e *CommandExecutor) sendToVehicle(ctx context.Context, v *models.Vehicle, cfg *CommandConfig) CommandResult {
	start := time.Now()

	result := CommandResult{
		VehicleID:   v.ID,
		VehicleName: v.DisplayName,
		Command:     cfg.Command,
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

	// Log the command execution to command_logs.
	paramsJSON, _ := json.Marshal(cfg.Params)
	cl := &models.CommandLog{
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

	e.logger.Info().
		Int64("vehicle_id", v.ID).
		Str("vehicle_name", v.DisplayName).
		Str("command", cfg.Command).
		Str("status", status).
		Int64("duration_ms", result.DurationMs).
		Msg("automation command executed")

	return result
}
