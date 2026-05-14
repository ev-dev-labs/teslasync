// Package redactadapter bridges F4's [strategy.RedactionPolicy] marker
// interface with F8's concrete [redact.Policy] value type.
//
// The interface is in `internal/ai/strategy` and uses an unexported
// marker method (`policyMarker()`) so external packages cannot
// satisfy it without embedding [strategy.NoRedaction]. The concrete
// policy type lives in `internal/ai/redact`. Putting the bridge here
// — in a small package that imports BOTH — avoids the import cycle
// that would otherwise form (provider → redact → strategy → provider).
//
// Strategies use [Wrap] to declare their policy:
//
//	func (s *Chatbot) RedactionPolicy() strategy.RedactionPolicy {
//	    return redactadapter.Wrap(redact.PolicyChatbot())
//	}
//
// The dispatcher uses [From] to extract the policy when threading it
// through ctx for the redact decorator.
package redactadapter

import (
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// PolicyAdapter satisfies [strategy.RedactionPolicy] while carrying a
// concrete [redact.Policy]. The embedded [strategy.NoRedaction]
// brings the unexported marker method into scope so the type
// satisfies the interface from outside the strategy package.
type PolicyAdapter struct {
	strategy.NoRedaction
	Inner redact.Policy
}

// Wrap returns a [strategy.RedactionPolicy] carrying p. Intended as
// the return value of a strategy's RedactionPolicy method.
func Wrap(p redact.Policy) strategy.RedactionPolicy {
	return PolicyAdapter{Inner: p}
}

// From extracts the concrete [redact.Policy] from a
// [strategy.RedactionPolicy]. Returns [redact.DefaultPolicy] when the
// input is the F4 [strategy.NoRedaction] placeholder, a nil
// interface, or any other unrecognised implementation.
//
// "Unrecognised" includes nil — defence in depth so a buggy strategy
// returning the zero value cannot bypass redaction.
func From(sp strategy.RedactionPolicy) redact.Policy {
	if sp == nil {
		return redact.DefaultPolicy()
	}
	switch v := sp.(type) {
	case PolicyAdapter:
		return v.Inner
	case *PolicyAdapter:
		if v == nil {
			return redact.DefaultPolicy()
		}
		return v.Inner
	default:
		return redact.DefaultPolicy()
	}
}
