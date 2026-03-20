package resilience

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// ComponentStatus represents the health state of a system component.
type ComponentStatus int

const (
	StatusHealthy  ComponentStatus = iota
	StatusDegraded
	StatusUnhealthy
	StatusUnknown
)

func (s ComponentStatus) String() string {
	switch s {
	case StatusHealthy:
		return "healthy"
	case StatusDegraded:
		return "degraded"
	case StatusUnhealthy:
		return "unhealthy"
	default:
		return "unknown"
	}
}

// Component tracks the health of a single system dependency.
type Component struct {
	Name          string          `json:"name"`
	Status        ComponentStatus `json:"status"`
	LastCheck     time.Time       `json:"last_check"`
	LastError     string          `json:"last_error,omitempty"`
	ConsecFails   int             `json:"consecutive_failures"`
	TotalFailures int64           `json:"total_failures"`
	TotalChecks   int64           `json:"total_checks"`
}

// HealthMonitor tracks the status of all system components.
type HealthMonitor struct {
	mu         sync.RWMutex
	components map[string]*Component
}

// NewHealthMonitor creates a new system health monitor.
func NewHealthMonitor() *HealthMonitor {
	return &HealthMonitor{
		components: make(map[string]*Component),
	}
}

// Register registers a component for health tracking.
func (hm *HealthMonitor) Register(name string) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	hm.components[name] = &Component{
		Name:   name,
		Status: StatusUnknown,
	}
}

// RecordSuccess marks a healthy check for a component.
func (hm *HealthMonitor) RecordSuccess(name string) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	c, ok := hm.components[name]
	if !ok {
		return
	}
	c.Status = StatusHealthy
	c.ConsecFails = 0
	c.LastCheck = time.Now()
	c.LastError = ""
	c.TotalChecks++
}

// RecordFailure marks a failed check for a component.
func (hm *HealthMonitor) RecordFailure(name string, err error) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	c, ok := hm.components[name]
	if !ok {
		return
	}
	c.ConsecFails++
	c.TotalFailures++
	c.TotalChecks++
	c.LastCheck = time.Now()
	if err != nil {
		c.LastError = err.Error()
	}
	if c.ConsecFails >= 5 {
		c.Status = StatusUnhealthy
	} else if c.ConsecFails >= 2 {
		c.Status = StatusDegraded
	}
}

// GetStatus returns the current status of all components.
func (hm *HealthMonitor) GetStatus() map[string]*Component {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	result := make(map[string]*Component, len(hm.components))
	for k, v := range hm.components {
		cp := *v
		result[k] = &cp
	}
	return result
}

// OverallStatus returns the worst status across all components.
func (hm *HealthMonitor) OverallStatus() ComponentStatus {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	worst := StatusHealthy
	for _, c := range hm.components {
		if c.Status > worst {
			worst = c.Status
		}
	}
	return worst
}

// IsDegraded returns true if any component is not healthy.
func (hm *HealthMonitor) IsDegraded() bool {
	return hm.OverallStatus() != StatusHealthy
}

// HealthSnapshot represents a point-in-time health check result.
type HealthSnapshot struct {
	Timestamp time.Time                  `json:"timestamp"`
	Overall   ComponentStatus            `json:"overall"`
	Components map[string]ComponentStatus `json:"components"`
}

// GetHealthHistory returns recent health snapshots (placeholder — returns current state).
func (hm *HealthMonitor) GetHealthHistory() []HealthSnapshot {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	snap := HealthSnapshot{
		Timestamp:  time.Now(),
		Overall:    hm.OverallStatus(),
		Components: make(map[string]ComponentStatus),
	}
	for name, c := range hm.components {
		snap.Components[name] = c.Status
	}
	return []HealthSnapshot{snap}
}

// RetryConfig configures retry behavior.
type RetryConfig struct {
	MaxAttempts int
	InitialWait time.Duration
	MaxWait     time.Duration
	Multiplier  float64 // backoff multiplier
	Jitter      bool
}

// DefaultRetryConfig returns sensible retry defaults.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts: 5,
		InitialWait: 1 * time.Second,
		MaxWait:     30 * time.Second,
		Multiplier:  2.0,
		Jitter:      true,
	}
}

// Retry executes fn with exponential backoff retries.
// Returns the last error if all attempts fail.
func Retry(ctx context.Context, name string, cfg RetryConfig, fn func(ctx context.Context) error) error {
	var lastErr error
	wait := cfg.InitialWait

	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		lastErr = fn(ctx)
		if lastErr == nil {
			if attempt > 1 {
				log.Info().Str("operation", name).Int("attempt", attempt).Msg("succeeded after retry")
			}
			return nil
		}

		if attempt == cfg.MaxAttempts {
			break
		}

		if ctx.Err() != nil {
			return fmt.Errorf("%s: context cancelled during retry: %w", name, ctx.Err())
		}

		log.Warn().Err(lastErr).Str("operation", name).Int("attempt", attempt).Int("max", cfg.MaxAttempts).Dur("next_wait", wait).Msg("retrying after failure")

		// Apply jitter: ±25%
		sleepDur := wait
		if cfg.Jitter {
			jitter := float64(wait) * 0.25
			sleepDur = time.Duration(float64(wait) + (rand.Float64()*2-1)*jitter)
		}

		select {
		case <-time.After(sleepDur):
		case <-ctx.Done():
			return fmt.Errorf("%s: context cancelled waiting to retry: %w", name, ctx.Err())
		}

		wait = time.Duration(math.Min(float64(wait)*cfg.Multiplier, float64(cfg.MaxWait)))
	}

	return fmt.Errorf("%s: all %d attempts failed: %w", name, cfg.MaxAttempts, lastErr)
}

// RetryWithResult executes fn with exponential backoff retries and returns a result.
func RetryWithResult[T any](ctx context.Context, name string, cfg RetryConfig, fn func(ctx context.Context) (T, error)) (T, error) {
	var zero T
	var result T
	err := Retry(ctx, name, cfg, func(ctx context.Context) error {
		var e error
		result, e = fn(ctx)
		return e
	})
	if err != nil {
		return zero, err
	}
	return result, nil
}

// ConnectWithRetry repeatedly attempts to connect with exponential backoff.
// Uses a more aggressive config suitable for startup.
func ConnectWithRetry(ctx context.Context, name string, maxAttempts int, fn func(ctx context.Context) error) error {
	cfg := RetryConfig{
		MaxAttempts: maxAttempts,
		InitialWait: 2 * time.Second,
		MaxWait:     30 * time.Second,
		Multiplier:  2.0,
		Jitter:      true,
	}
	return Retry(ctx, name, cfg, fn)
}

// SafeGo runs a function in a goroutine with panic recovery.
func SafeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Error().Str("goroutine", name).Interface("panic", r).Msg("recovered from panic in goroutine")
			}
		}()
		fn()
	}()
}

// SafeGoLoop runs a function in a goroutine with panic recovery that restarts on panic.
func SafeGoLoop(ctx context.Context, name string, fn func(ctx context.Context)) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Error().Str("goroutine", name).Interface("panic", r).Msg("recovered from panic, restarting loop")
					}
				}()
				fn(ctx)
			}()

			// Brief pause before restart after panic
			select {
			case <-time.After(2 * time.Second):
			case <-ctx.Done():
				return
			}
		}
	}()
}
