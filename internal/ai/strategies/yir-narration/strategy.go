// Package yirnarration is the Phase-50 / U3 strategy for the
// LLM-narrated year-in-review slides.
//
// The strategy declares:
//
//   - the system prompt that frames the narration as a friendly,
//     factual annual recap based strictly on the supplied year-in-
//     review aggregate (no hallucinated metrics);
//   - the single read-only tool the LLM is allowed to call —
//     `query_year_in_review_context` — which composes existing
//     DriveSource + ChargeSource repo methods to return the year's
//     aggregate (no new SQL written);
//   - the redaction policy (`PolicyYearInReview` allows
//     ClassVehicleName so the narration can address the user's car
//     by name; every other PII class is redacted via round-trip tags).
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_year_review_handler.go` which builds a dispatcher,
// a stream.Writer (SSE), and runs a one-shot generation loop. The
// non-AI baseline at GET /api/v1/analytics/year-review (rendered by
// the SPA route /year-review/:year via SLIDE_DEFS) is unaffected —
// see `internal/api/year_review_handler.go` for the deterministic
// template renderer that remains the canonical baseline in off mode
// (ADR-015 §I3).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the template slides.
//   - I7 per-feature:     the AI route is gated by guard.Wrap("yir-narration").
//   - I9 redaction:       PolicyYearInReview restricts cleartext to vehicle
//                         name only (mirrors PolicyDigest's posture).
package yirnarration

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy. Exported
// so wiring code (router.go, tests) can reference the same constant
// the strategy registers itself with — typo-proof via compile error.
const FeatureID = "yir-narration"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every narration. Kept in a single named place so eval
// goldens (internal/ai/strategies/yir-narration/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly forbids hallucinated metrics — every concrete
// number must come from the `query_year_in_review_context` tool reply
// (the dispatcher refuses to expose any tool the strategy did not
// declare in Tools()). It also asks for short per-slide captions so
// the rendered narration fits the existing slide deck without a
// dedicated layout slice.
const SystemPrompt = `You are the TeslaSync year-in-review narrator. ` +
	`Produce a short, upbeat, factual annual recap of the user's year based STRICTLY on the data returned by query_year_in_review_context. ` +
	`Format the response as a sequence of brief slide captions (one short sentence per slide) covering: total drives, total distance, total energy, charging summary, and a closing recap. ` +
	`Never invent metrics — if a value is zero or missing, say so plainly. ` +
	`Address the vehicle by its display name when one is provided. ` +
	`Refuse politely if asked to disclose data for any vehicle other than the one named in the request.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry (see internal/ai/tools/year_review.go)
// at dispatcher construction time — the dispatcher refuses to mount
// a strategy that references an unknown tool.
//
// This slice ships zero mutating tools: year-in-review narration only
// READS state. A future slice that needs to mutate state (e.g.
// publishing the narration to a shareable URL) will add its own
// strategy with mutating tools + a confirm hook.
var allowedTools = []string{
	"query_year_in_review_context",
}

// Strategy is the concrete strategy.Strategy implementation for
// year-in-review narration. Construct via [New]; the zero value is
// intentionally non-functional so a forgotten constructor surfaces
// as a runtime nil dereference rather than silently using empty
// defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs — the
// strategy is a pure value with no internal state — so this is
// effectively a sentinel constructor used to make wiring intent
// readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the canonical
// registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the deterministic
// system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy of
// the allowed tool names so a caller cannot mutate the package-level
// allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "narrate vehicle N's year Y" prompt
// before the call, so the strategy itself contributes no extra prefix
// messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle preferences snippet (e.g.
// "user prefers metric units") would be injected once year-in-review
// narration grows that surface. Today's slice keeps Context empty so
// the dispatcher's behaviour is fully determined by [System] +
// History — the simplest path that satisfies the slice's "no hidden
// state" requirement.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyYearInReview wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete policy.
//
// PolicyYearInReview allows ClassVehicleName because the narration's
// value proposition includes naming the user's car ("This year, Roadie
// covered 12,500 km"). Every other PII class — VIN, lat/long, address,
// email, etc. — is redacted to a round-trip tag like `<vin id='1'/>`;
// the F8 redact decorator restores the original value before delivering
// the LLM's response back to the user.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyYearInReview())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from `internal/ai/strategies/yir-narration/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
