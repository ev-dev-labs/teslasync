package action

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// MaxKeyLength is the maximum allowed length for a variable key.
const MaxKeyLength = 255

// MaxValueLength is the maximum allowed length for a resolved variable value.
const MaxValueLength = 4096

// validKeyRe validates variable keys: alphanumeric, underscores, dots, hyphens.
var validKeyRe = regexp.MustCompile(`^[a-zA-Z0-9_.\-]+$`)

// VariableRepo abstracts the automation_variables persistence layer.
type VariableRepo interface {
	Get(ctx context.Context, key string) (*VariableEntry, error)
	Set(ctx context.Context, key, value string, vehicleID *int64) error
}

// VariableEntry represents a stored automation variable.
// Mirrors automationmodel.AutomationVariable but avoids a models import in the action package.
type VariableEntry struct {
	Key   string
	Value string
}

// SetVariableConfig represents the parsed action config for set_variable actions.
type SetVariableConfig struct {
	Type  string            `json:"type"`  // "set_variable"
	Key   string            `json:"key"`   // variable key
	Value string            `json:"value"` // template string with {{var}} placeholders
	Vars  map[string]string `json:"vars"`  // template variables for resolution
}

// SetVariableResult captures the outcome of a set_variable action.
type SetVariableResult struct {
	Key           string  `json:"key"`
	Value         string  `json:"value"`          // resolved value that was stored
	PreviousValue *string `json:"previous_value"` // nil if variable was not previously set
}

// SetVariableExecutor stores automation variables as an automation action.
type SetVariableExecutor struct {
	repo   VariableRepo
	logger zerolog.Logger
}

// NewSetVariableExecutor creates a set_variable action executor.
func NewSetVariableExecutor(repo VariableRepo) *SetVariableExecutor {
	return &SetVariableExecutor{
		repo: repo,
		logger: log.With().
			Str("component", "set_variable_action").
			Logger(),
	}
}

// DecodeSetVariableSpec unmarshals and validates a set_variable action config.
func DecodeSetVariableSpec(raw json.RawMessage) (*SetVariableConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("action config is empty")
	}

	var cfg SetVariableConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal set_variable action config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "set_variable" {
		return nil, fmt.Errorf("expected type \"set_variable\", got %q", cfg.Type)
	}

	if cfg.Key == "" {
		return nil, fmt.Errorf("key is required")
	}

	if len(cfg.Key) > MaxKeyLength {
		return nil, fmt.Errorf("key exceeds maximum length of %d", MaxKeyLength)
	}

	if !validKeyRe.MatchString(cfg.Key) {
		return nil, fmt.Errorf("key %q contains invalid characters (allowed: a-z, A-Z, 0-9, _, ., -)", cfg.Key)
	}

	if cfg.Value == "" {
		return nil, fmt.Errorf("value is required")
	}

	return &cfg, nil
}

var ParseSetVariableConfig = DecodeSetVariableSpec

// Execute resolves template placeholders in the value, stores the variable,
// and returns a JSON result with the resolved value and previous value.
func (e *SetVariableExecutor) Execute(ctx context.Context, vehicleID *int64, raw json.RawMessage) (json.RawMessage, error) {
	cfg, err := DecodeSetVariableSpec(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid set_variable action config: %w", err)
	}

	// Resolve template placeholders in the value.
	resolved := resolveTemplate(cfg.Value, cfg.Vars)

	if len(resolved) > MaxValueLength {
		return nil, fmt.Errorf("resolved value exceeds maximum length of %d", MaxValueLength)
	}

	// Read the previous value for the result.
	var previousValue *string
	if prev, err := e.repo.Get(ctx, cfg.Key); err != nil {
		e.logger.Warn().Err(err).
			Str("key", cfg.Key).
			Msg("failed to read previous variable value")
	} else if prev != nil {
		previousValue = &prev.Value
	}

	// Store the variable.
	if err := e.repo.Set(ctx, cfg.Key, resolved, vehicleID); err != nil {
		return nil, fmt.Errorf("store variable %q: %w", cfg.Key, err)
	}

	result := SetVariableResult{
		Key:           cfg.Key,
		Value:         resolved,
		PreviousValue: previousValue,
	}

	e.logger.Info().
		Str("key", cfg.Key).
		Str("value", resolved).
		Msg("automation variable set")

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal set_variable result: %w", err)
	}

	return resultJSON, nil
}
