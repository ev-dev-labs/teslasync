package eval

import (
	"context"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// GenericStrategy adapts a [FeatureSpec] into a [strategy.Strategy].
// Used by the runner to exercise the harness end-to-end before any
// real Strategy implementation has shipped (F6 ships the harness; U1+
// ship the per-feature Strategy).
//
// The implementation is minimal:
//
//   - FeatureID  → spec.ID
//   - System     → spec.System
//   - Tools      → spec.Tools
//   - Context    → []provider.Message{} (the dispatcher seeds the user
//     message itself from StrategyInput.LastMessage by way
//     of in.History — see ChatRequestFromInput below).
//   - Redaction  → strategy.NoRedaction{}
//   - EvalGoldens→ nil (the harness owns goldens; no recursion).
//
// A real Strategy implementation that ships later in U1 / N1 / etc.
// MAY be registered via [RegisterStrategy] to override the
// GenericStrategy for that feature ID.
type GenericStrategy struct {
	Spec FeatureSpec
}

// NewGenericStrategy returns a Strategy backed by the given spec.
func NewGenericStrategy(spec FeatureSpec) *GenericStrategy {
	return &GenericStrategy{Spec: spec}
}

// FeatureID implements [strategy.Strategy].
func (g *GenericStrategy) FeatureID() string { return g.Spec.ID }

// System implements [strategy.Strategy].
func (g *GenericStrategy) System() string { return g.Spec.System }

// Tools implements [strategy.Strategy].
func (g *GenericStrategy) Tools() []string {
	out := make([]string, len(g.Spec.Tools))
	copy(out, g.Spec.Tools)
	return out
}

// Context implements [strategy.Strategy]. Returns no extra messages —
// the runner pre-seeds the user message into StrategyInput.History so
// the dispatcher's standard message assembly (system → context →
// history) yields the canonical [system, user] preamble.
func (g *GenericStrategy) Context(ctx context.Context, in strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy].
func (g *GenericStrategy) RedactionPolicy() strategy.RedactionPolicy {
	return strategy.NoRedaction{}
}

// EvalGoldens implements [strategy.Strategy]. Returns nil — the
// harness already owns the goldens load path.
func (g *GenericStrategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time: GenericStrategy satisfies the port.
var _ strategy.Strategy = (*GenericStrategy)(nil)

// strategyRegistry is the per-process map of Strategy overrides.
// Populated by [RegisterStrategy] from feature-slice init() functions
// (or from explicit wiring in tests).
var (
	strategyRegistryMu sync.RWMutex
	strategyRegistry   = map[string]strategy.Strategy{}
)

// RegisterStrategy installs a real Strategy override for the given
// feature ID. The runner prefers a registered Strategy over the
// GenericStrategy synthesized from the YAML header, so future feature
// slices can ship their dispatcher-aware implementations without
// touching the eval harness.
//
// Calling RegisterStrategy twice for the same ID PANICS — duplicate
// registrations are a programming error (a feature has exactly one
// Strategy).
func RegisterStrategy(s strategy.Strategy) {
	if s == nil {
		panic("eval: RegisterStrategy called with nil Strategy")
	}
	id := s.FeatureID()
	if id == "" {
		panic("eval: RegisterStrategy: Strategy.FeatureID() is empty")
	}
	strategyRegistryMu.Lock()
	defer strategyRegistryMu.Unlock()
	if _, dup := strategyRegistry[id]; dup {
		panic("eval: duplicate RegisterStrategy for " + id)
	}
	strategyRegistry[id] = s
}

// LookupStrategy returns the registered Strategy for the given ID, or
// (nil, false) if none.
func LookupStrategy(id string) (strategy.Strategy, bool) {
	strategyRegistryMu.RLock()
	defer strategyRegistryMu.RUnlock()
	s, ok := strategyRegistry[id]
	return s, ok
}

// resetStrategyRegistry is a test-only helper that empties the
// registry. Exported via the underscore-prefixed name so production
// callers don't accidentally use it; tests in this package can call
// it directly because it's same-package.
func resetStrategyRegistry() {
	strategyRegistryMu.Lock()
	defer strategyRegistryMu.Unlock()
	strategyRegistry = map[string]strategy.Strategy{}
}
