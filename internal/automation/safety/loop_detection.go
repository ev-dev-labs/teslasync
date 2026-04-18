// Package safety implements pre-execution safety checks for automations.
package safety

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// ─── Sentinel Errors ───────────────────────────────────

// ErrCycleDetected is the sentinel for cycle detection.
// Use errors.Is(err, ErrCycleDetected) to test.
var ErrCycleDetected = errors.New("automation cycle detected")

// CycleError carries the full automation chain path when a cycle is found.
// Supports errors.Is(err, ErrCycleDetected).
type CycleError struct {
	Path []int64 // ordered IDs: [A, B, C, A] — the duplicate is the last element
}

func (e *CycleError) Error() string {
	parts := make([]string, len(e.Path))
	for i, id := range e.Path {
		parts[i] = fmt.Sprintf("%d", id)
	}
	return fmt.Sprintf("automation cycle detected: %s", strings.Join(parts, " → "))
}

func (e *CycleError) Is(target error) bool {
	return target == ErrCycleDetected
}

// ─── Context-Based Chain Tracking ──────────────────────

// chainKey is the unexported context key for chain tracking.
type chainKey struct{}

// chainNode is an immutable linked-list node stored in context.
// Each Enter creates a new node pointing to its parent, so concurrent
// fan-out (multiple children from the same parent) never shares
// mutable state.
type chainNode struct {
	id     int64
	parent *chainNode
}

// path materializes the chain from root to this node (inclusive).
func (n *chainNode) path() []int64 {
	if n == nil {
		return nil
	}
	// Count depth first to allocate exact-size slice.
	depth := 0
	for cur := n; cur != nil; cur = cur.parent {
		depth++
	}
	result := make([]int64, depth)
	cur := n
	for i := depth - 1; i >= 0; i-- {
		result[i] = cur.id
		cur = cur.parent
	}
	return result
}

// contains checks whether this chain already includes the given ID.
func (n *chainNode) contains(id int64) bool {
	for cur := n; cur != nil; cur = cur.parent {
		if cur.id == id {
			return true
		}
	}
	return false
}

// chainFromContext extracts the current chain node from context.
func chainFromContext(ctx context.Context) *chainNode {
	v, _ := ctx.Value(chainKey{}).(*chainNode)
	return v
}

// ChainFromContext returns the ordered automation IDs in the current
// execution chain. Returns nil if no chain is active.
func ChainFromContext(ctx context.Context) []int64 {
	return chainFromContext(ctx).path()
}

// ChainDepth returns the current depth of the automation chain.
func ChainDepth(ctx context.Context) int {
	return len(chainFromContext(ctx).path())
}

// ─── Auto-Disabler Interface ───────────────────────────

// AutoDisabler is the interface for pausing runaway automations.
// Implementations should be idempotent (e.g., UPDATE ... WHERE auto_disabled=false).
type AutoDisabler interface {
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// ─── Rapid-Fire Detection ──────────────────────────────

// RapidFireResult contains the outcome of a rapid-fire check.
type RapidFireResult struct {
	Exceeded  bool          `json:"exceeded"`
	Count     int           `json:"count"`
	Threshold int           `json:"threshold"`
	Window    time.Duration `json:"window"`
}

// ─── Loop Detector ─────────────────────────────────────

// DefaultMaxFires is the default rapid-fire threshold (fires per window).
const DefaultMaxFires = 5

// DefaultWindow is the default rapid-fire sliding window duration.
const DefaultWindow = 1 * time.Minute

// LoopDetector provides two independent safety checks:
//  1. Cycle detection — context-propagated chain tracking prevents A→B→A loops.
//  2. Rapid-fire detection — sliding window counters auto-pause automations
//     that fire too frequently.
//
// Cycle detection is per-chain (no global lock). Rapid-fire state is in-memory
// and per-process; it resets on restart and does not coordinate across pods.
type LoopDetector struct {
	mu         sync.Mutex
	windows    map[int64][]time.Time
	maxFires   int
	windowSize time.Duration
	disabler   AutoDisabler // nil means no auto-disable
	nowFunc    func() time.Time
	logger     zerolog.Logger
}

// LoopDetectorOption configures the LoopDetector.
type LoopDetectorOption func(*LoopDetector)

// WithMaxFires sets the rapid-fire threshold.
func WithMaxFires(n int) LoopDetectorOption {
	return func(ld *LoopDetector) { ld.maxFires = n }
}

// WithWindow sets the rapid-fire sliding window duration.
func WithWindow(d time.Duration) LoopDetectorOption {
	return func(ld *LoopDetector) { ld.windowSize = d }
}

// WithDisabler sets the AutoDisabler for auto-pausing runaway automations.
func WithDisabler(d AutoDisabler) LoopDetectorOption {
	return func(ld *LoopDetector) { ld.disabler = d }
}

// NewLoopDetector creates a LoopDetector with the given options.
func NewLoopDetector(opts ...LoopDetectorOption) *LoopDetector {
	ld := &LoopDetector{
		windows:    make(map[int64][]time.Time),
		maxFires:   DefaultMaxFires,
		windowSize: DefaultWindow,
		nowFunc:    func() time.Time { return time.Now().UTC() },
		logger: log.With().
			Str("component", "loop_detector").
			Logger(),
	}
	for _, opt := range opts {
		opt(ld)
	}
	return ld
}

// ─── Cycle Detection ───────────────────────────────────

// CheckCycle verifies that adding automationID to the current chain does not
// create a cycle. On success it returns a new context with the ID appended
// to the chain. On cycle detection it returns a *CycleError (which satisfies
// errors.Is(err, ErrCycleDetected)).
//
// The returned context MUST be used for any nested automation dispatch so
// that deeper calls inherit the chain.
func (ld *LoopDetector) CheckCycle(ctx context.Context, automationID int64) (context.Context, error) {
	current := chainFromContext(ctx)

	if current != nil && current.contains(automationID) {
		path := append(current.path(), automationID)
		ld.logger.Warn().
			Int64("automation_id", automationID).
			Ints64("chain", path).
			Msg("automation cycle detected")
		return ctx, &CycleError{Path: path}
	}

	node := &chainNode{
		id:     automationID,
		parent: current,
	}
	return context.WithValue(ctx, chainKey{}, node), nil
}

// ─── Rapid-Fire Detection ──────────────────────────────

// RecordFire records an execution timestamp and checks whether the automation
// has exceeded the rapid-fire threshold. It prunes expired timestamps on every
// call to bound memory usage.
func (ld *LoopDetector) RecordFire(automationID int64) RapidFireResult {
	ld.mu.Lock()
	defer ld.mu.Unlock()

	now := ld.nowFunc()
	cutoff := now.Add(-ld.windowSize)

	// Prune expired timestamps.
	timestamps := ld.windows[automationID]
	pruned := timestamps[:0]
	for _, ts := range timestamps {
		if ts.After(cutoff) {
			pruned = append(pruned, ts)
		}
	}

	// Append the new fire.
	pruned = append(pruned, now)
	ld.windows[automationID] = pruned

	return RapidFireResult{
		Exceeded:  len(pruned) > ld.maxFires,
		Count:     len(pruned),
		Threshold: ld.maxFires,
		Window:    ld.windowSize,
	}
}

// CheckRapidFire checks rapid-fire without recording a new timestamp.
// Useful for read-only inspection.
func (ld *LoopDetector) CheckRapidFire(automationID int64) RapidFireResult {
	ld.mu.Lock()
	defer ld.mu.Unlock()

	cutoff := ld.nowFunc().Add(-ld.windowSize)

	timestamps := ld.windows[automationID]
	count := 0
	for _, ts := range timestamps {
		if ts.After(cutoff) {
			count++
		}
	}

	return RapidFireResult{
		Exceeded:  count > ld.maxFires,
		Count:     count,
		Threshold: ld.maxFires,
		Window:    ld.windowSize,
	}
}

// ─── Combined Pre-Execution Check ──────────────────────

// BeforeExecute is the single entrypoint for all safety checks before running
// an automation. It:
//  1. Checks for cycles in the current chain (via context).
//  2. Records the fire and checks rapid-fire threshold.
//  3. If rapid-fire is exceeded and an AutoDisabler is configured, auto-disables
//     the automation (idempotently).
//
// Returns the updated context (for downstream chain propagation) and an error
// if execution should be blocked.
func (ld *LoopDetector) BeforeExecute(ctx context.Context, automationID int64) (context.Context, error) {
	// 1. Cycle check.
	newCtx, err := ld.CheckCycle(ctx, automationID)
	if err != nil {
		return ctx, err
	}

	// 2. Rapid-fire check.
	result := ld.RecordFire(automationID)
	if result.Exceeded {
		reason := fmt.Sprintf(
			"rapid-fire: %d executions in %s (threshold: %d)",
			result.Count, result.Window, result.Threshold,
		)

		ld.logger.Warn().
			Int64("automation_id", automationID).
			Int("count", result.Count).
			Int("threshold", result.Threshold).
			Dur("window", result.Window).
			Msg("automation rapid-fire detected, auto-pausing")

		// 3. Auto-disable if disabler is configured.
		if ld.disabler != nil {
			if disableErr := ld.disabler.SetAutoDisabled(ctx, automationID, reason); disableErr != nil {
				ld.logger.Error().Err(disableErr).
					Int64("automation_id", automationID).
					Msg("failed to auto-disable rapid-fire automation")
			}
		}

		return ctx, fmt.Errorf("automation %d blocked: %s", automationID, reason)
	}

	return newCtx, nil
}

// Reset clears all rapid-fire state. Useful for testing or after
// configuration changes.
func (ld *LoopDetector) Reset() {
	ld.mu.Lock()
	defer ld.mu.Unlock()
	ld.windows = make(map[int64][]time.Time)
}

// ResetAutomation clears rapid-fire state for a single automation.
func (ld *LoopDetector) ResetAutomation(automationID int64) {
	ld.mu.Lock()
	defer ld.mu.Unlock()
	delete(ld.windows, automationID)
}
