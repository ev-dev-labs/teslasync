package redact

// Policy is the per-feature redaction configuration. It is consulted
// by [Apply] (and therefore by the redact decorator) on every outbound
// AI call. Strategies declare a Policy via their [strategy.Strategy]
// implementation and the dispatcher threads it through ctx.
//
// Defaults are the deny-everything stance: no class is in Allow, Mode
// is [ModeRedactedTags] so the LLM's reply can be round-tripped if the
// feature wants to.
//
// This package deliberately does NOT import internal/ai/strategy so
// that internal/ai/provider can depend on redact without forming a
// cycle (provider ← strategy ← provider). The strategy adapter lives
// in internal/ai/strategy/redactadapter and is the bridge between
// strategy.RedactionPolicy and redact.Policy.
type Policy struct {
	// Allow is the set of [PIIClass] values that are permitted to
	// flow through to the provider verbatim. Classes NOT in this set
	// are rewritten according to Mode. Order is irrelevant; duplicates
	// are tolerated.
	Allow []PIIClass

	// Mode controls how disallowed classes are rewritten. Defaults to
	// [ModeRedactedTags] (round-trippable).
	Mode Mode

	// Bypass, when true, completely skips the redactor for this call.
	// Used by local-loopback providers (Ollama on 127.0.0.1) where
	// the data never leaves the host. The decorator still records
	// the bypass in the audit row so an operator can spot a
	// misconfigured cloud provider that was accidentally tagged
	// local. Default false (always redact).
	Bypass bool

	// EnablePlate opts the plate detector into the chain. Default
	// false because the plate regex has a high false-positive rate
	// on alphanumeric IDs (per prompt D9.2 "opt-in via class").
	// Features that explicitly want plates redacted set this true.
	EnablePlate bool
}

// allowSet returns Allow as a map for O(1) lookup. Internal helper.
func (p Policy) allowSet() map[PIIClass]bool {
	if len(p.Allow) == 0 {
		return nil
	}
	out := make(map[PIIClass]bool, len(p.Allow))
	for _, c := range p.Allow {
		out[c] = true
	}
	return out
}

// AllowsAll reports whether the policy permits every supported class.
// Used by the decorator to short-circuit detector work when there is
// nothing to redact anyway.
func (p Policy) AllowsAll() bool {
	if len(p.Allow) < len(allClasses) {
		return false
	}
	set := p.allowSet()
	for _, c := range allClasses {
		if !set[c] {
			return false
		}
	}
	return true
}

// DefaultPolicy returns the deny-everything stance. Returned by
// [redactadapter.From] (in internal/ai/strategy/redactadapter) when
// the strategy returns the F4 [strategy.NoRedaction] placeholder
// (which carries no policy data).
//
// Rationale: ADR-015 §I9 requires PII never leaks. A strategy that
// has not declared an explicit policy is by definition unaudited, so
// the safe default is "redact everything".
func DefaultPolicy() Policy {
	return Policy{Allow: nil, Mode: ModeRedactedTags, Bypass: false}
}
