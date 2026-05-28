// Package anomalyexplanations is the Phase-50 / U4 strategy for the
// LLM-narrated explanation of already-detected anomalies.
//
// The strategy declares:
//
//   - the system prompt that frames the narration as a calm, factual
//     explanation of anomalies the deterministic detector ALREADY
//     identified — never invents new anomalies, never proposes
//     suppression or threshold edits;
//   - the single read-only tool the LLM is allowed to call —
//     `query_anomaly_context` — which calls into the existing
//     (*apianomaly.Handler).DetectAnomalies (no new SQL written);
//   - the redaction policy (`PolicyDigest`) which allows
//     ClassVehicleName so the narration can address the user's car
//     by name; every other PII class is redacted via round-trip tags.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_anomaly_handler.go` which builds a dispatcher, a
// stream.Writer (SSE), and runs a one-shot generation loop. The
// non-AI baseline at GET /api/v1/analytics/anomalies (rendered by
// the SPA route /anomaly-detection via AnomalyDashboardPage) is
// unaffected — the deterministic detector + safe-range explanation
// strings remain the canonical baseline in off mode (ADR-015 §I3).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the detector
//     or the static safeRanges-based messages
//     emitted by anomaly_handler.go.
//   - I7 per-feature:     the AI route is gated by guard.Wrap("anomaly-explanations").
//   - I9 redaction:       PolicyDigest restricts cleartext to vehicle
//     name only; numeric anomaly facts are bounded
//     and contain no free-form PII.
package anomalyexplanations

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
const FeatureID = "anomaly-explanations"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every explanation. Kept in a single named place so eval
// goldens (internal/ai/strategies/anomaly-explanations/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call query_anomaly_context
//     FIRST"): without this, a model may answer from priors and
//     hallucinate anomalies that the detector did not surface.
//   - Forbids inventing anomalies: only the items in the tool reply
//     may be discussed.
//   - Forbids proposing suppression or threshold changes: the
//     narrator EXPLAINS, the detector DETECTS, the alerting layer
//     ROUTES — separation of concerns is enforced at the prompt
//     boundary as defence-in-depth on top of the read-only tool
//     allowlist.
//   - Asks for a "no anomalies — all normal" reply when the tool
//     returns an empty list. This is the load-bearing prompt for the
//     `all_clear` golden.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller's own vehicle, so any other vehicle ID in the
//     user message is by definition out of scope.
const SystemPrompt = `You are the TeslaSync anomaly narrator. ` +
	`Your job is to EXPLAIN anomalies the deterministic detector has ALREADY identified. ` +
	`ALWAYS call query_anomaly_context FIRST, then answer STRICTLY from its reply — never invent, infer, or estimate anomalies that are not present in the tool output. ` +
	`If the tool returns no anomalies, say plainly that no anomalies were detected and the systems look normal. ` +
	`Do NOT propose suppressing alerts, changing thresholds, disabling monitoring, or any other state mutation — your role is read-only narration. ` +
	`Group anomalies by category (battery, tires, motors, hvac, charging) when there are multiple, and use plain conversational language a non-engineer can understand. ` +
	`Address the vehicle by its display name when one is provided. ` +
	`Refuse politely if asked to disclose data for any vehicle other than the one named in the request.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry (see internal/ai/tools/anomaly.go) at
// dispatcher construction time — the dispatcher refuses to mount a
// strategy that references an unknown tool.
//
// This slice ships zero mutating tools: anomaly explanation only
// READS already-detected state. A future "suggest a remediation"
// strategy that needs to propose a maintenance task will add its
// own strategy with its own confirm hook.
var allowedTools = []string{
	"query_anomaly_context",
}

// Strategy is the concrete strategy.Strategy implementation for
// anomaly explanation. Construct via [New]; the zero value is
// intentionally non-functional so a forgotten constructor surfaces as
// a runtime nil dereference rather than silently using empty defaults.
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
// handler builds the synthesised "explain anomalies for vehicle N
// over the last D days" prompt before the call, so the strategy
// itself contributes no extra prefix messages. Returning nil is
// correct.
//
// Future work: this is where a per-vehicle "user prefers SI vs US
// units" preference snippet would be injected once anomaly narration
// grows that surface. Today's slice keeps Context empty so the
// dispatcher's behaviour is fully determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyDigest wrapped through the F4↔F8 adapter so the dispatcher's
// per-request ctx-installation step (dispatch.Run installs the
// policy via redact.WithPolicy) sees the concrete policy.
//
// Per the slice prompt: "Policy: PolicyDigest from
// internal/ai/redact/policies.go. Allowed classes: ClassVehicleName
// only; anomaly facts are passed as bounded numeric DTOs". Reusing
// PolicyDigest is intentional — the narration's value proposition
// matches the digest's (name the car, never expose VINs/coords).
// A future change that diverges anomaly redaction from digest
// redaction can introduce a dedicated PolicyAnomalyExplanations()
// without touching this strategy's wiring.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyDigest())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/anomaly-explanations/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
