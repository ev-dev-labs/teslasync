// Package strategy defines the contract for a single AI feature's
// behaviour: which feature it is (so the provider/feature registry
// can resolve it), what system prompt to use, which tools it may
// call, what context to inject before each turn, what redaction
// policy applies, and what evaluation goldens it must keep
// passing.
//
// One Strategy = one feature. Implementations live next to the
// feature slice that owns them (chatbot, summarisation, etc.).
// The dispatcher (internal/ai/dispatch) orchestrates the chat loop
// and uses Strategy as a pure provider of per-feature configuration.
//
// ADR-015: Strategy is the ONLY place a feature gets to mint
// system prompts or pick tools. The dispatcher refuses to run
// without one. This guarantees a single accountable site per
// feature for every AI behaviour.
//
// F4 ships the interface only — no implementations. Each later
// feature slice (N1, N2, U1, ...) ships exactly one Strategy
// implementation.
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
	// outbound and inbound messages. F8 will define the concrete
	// policy type; F4 ships the placeholder so Dispatcher.Run
	// has somewhere to call into.
	RedactionPolicy() RedactionPolicy

	// EvalGoldens returns the deterministic test cases this
	// feature must keep passing. F6 (eval harness) reads them via
	// the strategy registry so adding a feature automatically
	// adds it to CI.
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

// RedactionPolicy is a forward-declared placeholder for the F8
// redaction policy type. The interface is intentionally empty —
// F4 only requires that Strategy can return SOMETHING that the
// dispatcher can pass through. F8 will widen this with a concrete
// Apply(...) method (or replace it with a struct alias).
//
// Until F8 lands, return NoRedaction{} from your Strategy.
type RedactionPolicy interface {
	// policyMarker is a non-exported marker so that no caller
	// outside this package can synthesise a "wrong" policy. F8
	// will add Apply(...) here.
	policyMarker()
}

// NoRedaction is the zero-value placeholder policy: pass everything
// through unchanged. Returned by features that have no redaction
// requirements (e.g., the F4 starter tools that touch only
// non-PII numeric data).
type NoRedaction struct{}

func (NoRedaction) policyMarker() {}

// EvalGolden is a forward-declared placeholder for the F6 eval
// harness's golden test type. The interface is intentionally
// minimal — F6 will widen it. Strategies that have no goldens to
// declare yet may return nil.
type EvalGolden interface {
	// goldenMarker is a non-exported marker so that no caller
	// outside this package can synthesise a "wrong" golden. F6
	// will add fields/methods here.
	goldenMarker()
}
