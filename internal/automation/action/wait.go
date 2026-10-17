package action

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// MaxWaitSeconds is the upper bound for a wait action to prevent runaway delays.
const MaxWaitSeconds = 3600

// WaitConfig represents the parsed action config for wait actions.
type WaitConfig struct {
	Type            string `json:"type"`             // "wait"
	DurationSeconds int    `json:"duration_seconds"` // 1–3600
}

// WaitResult captures the outcome of a wait action.
type WaitResult struct {
	RequestedSeconds int    `json:"requested_seconds"`
	WaitedMs         int64  `json:"waited_ms"`
	Cancelled        bool   `json:"cancelled,omitempty"`
	CancelReason     string `json:"cancel_reason,omitempty"`
}

// WaitExecutor pauses execution for a configured duration between chained actions.
type WaitExecutor struct {
	logger zerolog.Logger
	// sleepFunc allows tests to override the sleep mechanism.
	sleepFunc func(ctx context.Context, d time.Duration) error
}

// NewWaitExecutor creates a wait action executor.
func NewWaitExecutor() *WaitExecutor {
	return &WaitExecutor{
		logger: log.With().
			Str("component", "wait_action").
			Logger(),
	}
}

// DecodeWaitSpec unmarshals and validates a wait action config.
func DecodeWaitSpec(raw json.RawMessage) (*WaitConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("action config is empty")
	}

	var cfg WaitConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal wait action config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "wait" {
		return nil, fmt.Errorf("expected type \"wait\", got %q", cfg.Type)
	}

	if cfg.DurationSeconds <= 0 {
		return nil, fmt.Errorf("duration_seconds must be positive, got %d", cfg.DurationSeconds)
	}

	if cfg.DurationSeconds > MaxWaitSeconds {
		return nil, fmt.Errorf("duration_seconds %d exceeds maximum of %d", cfg.DurationSeconds, MaxWaitSeconds)
	}

	return &cfg, nil
}

var ParseWaitConfig = DecodeWaitSpec

// Execute pauses for the configured duration, respecting context cancellation.
func (e *WaitExecutor) Execute(ctx context.Context, _ *int64, raw json.RawMessage) (json.RawMessage, error) {
	cfg, err := DecodeWaitSpec(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid wait action config: %w", err)
	}

	return e.executeDuration(ctx, cfg.DurationSeconds)
}

// ExecuteTyped consumes the canonical CTI child without a legacy JSON bridge.
func (e *WaitExecutor) ExecuteTyped(ctx context.Context, _ *int64, payload any) (json.RawMessage, error) {
	var durationS int
	switch a := payload.(type) {
	case *models.AutomationStepActionWait:
		if a == nil {
			return nil, fmt.Errorf("typed wait action is nil")
		}
		durationS = a.DurationS
	case models.AutomationStepActionWait:
		durationS = a.DurationS
	default:
		return nil, fmt.Errorf("unsupported typed wait payload %T", payload)
	}
	if durationS < 1 || durationS > MaxWaitSeconds {
		return nil, fmt.Errorf("duration_s must be between 1 and %d", MaxWaitSeconds)
	}
	return e.executeDuration(ctx, durationS)
}

func (e *WaitExecutor) executeDuration(ctx context.Context, durationS int) (json.RawMessage, error) {
	duration := time.Duration(durationS) * time.Second

	e.logger.Info().
		Int("duration_seconds", durationS).
		Msg("wait action starting")

	start := time.Now()

	waitErr := e.sleep(ctx, duration)

	result := WaitResult{
		RequestedSeconds: durationS,
		WaitedMs:         time.Since(start).Milliseconds(),
	}

	if waitErr != nil {
		result.Cancelled = true
		result.CancelReason = waitErr.Error()

		e.logger.Warn().
			Int("duration_seconds", durationS).
			Int64("waited_ms", result.WaitedMs).
			Msg("wait action cancelled")

		resultJSON, _ := json.Marshal(result)
		return resultJSON, fmt.Errorf("wait cancelled: %w", waitErr)
	}

	e.logger.Info().
		Int("duration_seconds", durationS).
		Int64("waited_ms", result.WaitedMs).
		Msg("wait action completed")

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal wait result: %w", err)
	}

	return resultJSON, nil
}

// sleep blocks for the given duration or until the context is cancelled.
func (e *WaitExecutor) sleep(ctx context.Context, d time.Duration) error {
	if e.sleepFunc != nil {
		return e.sleepFunc(ctx, d)
	}

	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
