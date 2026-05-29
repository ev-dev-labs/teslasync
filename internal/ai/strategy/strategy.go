// Package strategy defines the contract for a single AI feature's
// behaviour: which feature it is (so the provider/feature registry
// can resolve it), what system prompt to use, which tools it may
// call, what context to inject before each turn, what redaction
// policy applies, and what evaluation goldens it must keep
// passing.
//
// One Strategy = one feature. Implementations live next to the
// feature that owns them (chatbot, summarisation, etc.).
// The dispatcher (internal/ai/dispatch) orchestrates the chat loop
// and uses Strategy as a pure provider of per-feature configuration.
//
// ADR-015: Strategy is the ONLY place a feature gets to mint
// system prompts or pick tools. The dispatcher refuses to run
// without one. This guarantees a single accountable site per
// feature for every AI behaviour.
package strategy

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// Strategy describes how the dispatcher should run one AI feature.
//
// All methods MUST be safe for concurrent use — the dispatcher may
// call them from multiple goroutines if a single feature is fanned
// out across user requests.
type Strategy interface {
	// FeatureID returns the feature registry key (matches
	// provider.Registry.For). The dispatcher uses this to look up
	// the configured provider, model, and budget for the feature.
	FeatureID() string

	// System returns the system prompt for this feature. May be
	// empty.
	System() string

	// Tools returns the names of tools (registered in
	// internal/ai/tools.Registry) this strategy is allowed to
	// call. The dispatcher filters the registry to only this
	// subset before sending it to the LLM, so a strategy CANNOT
	// indirectly invoke tools it did not declare.
	Tools() []string

	// Context computes the per-turn message prefix to inject
	// before the user's last turn. Common patterns: inject
	// retrieved-context snippets, replay the last N messages, etc.
	// Returning an empty slice is allowed; returning an error
	// aborts the turn.
	Context(ctx context.Context, in StrategyInput) ([]provider.Message, error)

	// RedactionPolicy returns the redaction rules to apply to
	// outbound and inbound messages.
	RedactionPolicy() RedactionPolicy

	// EvalGoldens returns the deterministic test cases this
	// feature must keep passing.
	EvalGoldens() []EvalGolden
}

// StrategyInput is the payload the dispatcher hands to
// Strategy.Context for each turn. Implementations are free to
// ignore fields they do not need.
type StrategyInput struct {
	// UserID is the authenticated user invoking the feature. May
	// be zero for system-internal features.
	UserID int64

	// LastMessage is the most recent user-authored content.
	LastMessage string

	// History is the conversation so far, NEWEST LAST. The
	// dispatcher passes a defensive copy; mutating it has no
	// effect.
	History []provider.Message
}

// RedactionPolicy is a marker interface for strategy-specific redaction
// rules. Concrete adapters interpret the marker at dispatch time.
type RedactionPolicy interface {
	// policyMarker prevents callers outside this package from
	// synthesising an arbitrary policy.
	policyMarker()
}

// NoRedaction is the zero-value policy for features with no redaction
// requirements.
type NoRedaction struct{}

func (NoRedaction) policyMarker() {}

// EvalGolden is the minimal marker for a strategy evaluation case.
// Strategies that have no goldens to declare may return nil.
type EvalGolden interface {
	// goldenMarker prevents callers outside this package from
	// synthesising arbitrary goldens.
	goldenMarker()
}
