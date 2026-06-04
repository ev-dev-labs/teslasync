// Package chargingdiagnosis defines the LLM-narrated per-charging-session diagnosis strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the narration as a calm,
//     factual diagnosis of ONE already-completed (or in-progress)
//     charging session — explains existing flag patterns (trickle,
//     expensive, low-power, telemetry-gap/interrupted), never
//     invents events the deterministic aggregates do not surface,
//     never proposes mutations, never generalises across sessions
//     or vehicles;
//   - the two read-only tools the LLM is allowed to call —
//     `query_charge_session` (thin envelope over
//     a single *chargingmodel.ChargingSession by ID) and
//     `query_charging_aggregation` (deterministic
//     flag-detection envelope mirroring the frontend
//     web/src/lib/chargingAggregation.ts logic — trickle / expensive
//     / low_power / telemetry_gap / cost_zero / bad_power flags
//     plus derived metrics such as duration_min, kwh_added,
//     avg_power_kw, cost_per_kwh, charger_category);
//   - the redaction policy (`PolicyChargingDiagnosis`) which allows
//     ClassVehicleName so the diagnosis can address the user's car
//     by name; lat/long, addresses, charging-location names, VINs,
//     etc. are redacted via round-trip tags.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_charging_diagnosis_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /charging/:id
// — existing charging stat cards, hero gauges, charge curve, battery
// progress, and the existing deterministic flag badges (trickle /
// expensive / low-power / interrupted) computed by the frontend
// web/src/lib/chargingAggregation.ts — is unchanged. Off-mode users
// never see the AI surface at all (ADR-015 §I3, §I5, §I6); the
// existing deterministic flag badges remain the canonical
// classification path.
//
// This strategy does not change how flags are computed. The
// query_charging_aggregation tool mirrors the frontend's deterministic
// flag-detection logic so the LLM sees the same flags the user already
// sees; the AI explains those flags in plain language rather than
// redefining them.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces ChargingDetailPage's
//     deterministic stat cards, charge curve, or the
//     existing flag badges; it adds an opt-in
//     diagnosis panel alongside.
//   - I7 per-feature:     the AI route is gated by guard.Wrap("charging-diagnosis").
//   - I9 redaction:       PolicyChargingDiagnosis restricts cleartext to
//     vehicle name only; lat/long, charging location
//     names, and addresses stay tagged so a leaked
//     transcript does not reveal where the user
//     usually charges.
package chargingdiagnosis

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
const FeatureID = "charging-diagnosis"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every charging-diagnosis narration. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/charging-diagnosis/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call query_charge_session
//     AND query_charging_aggregation FIRST"): without this, a model
//     may answer from priors and hallucinate flag patterns the
//     deterministic aggregations do not actually surface.
//   - Forbids inventing facts: only the values returned by the tools
//     may be quoted. Per-second statements ("you started charging at
//     14:32") are forbidden because the tools return aggregates and
//     boolean flags, not per-row telemetry events.
//   - Constrains the diagnosis to the FOUR canonical flag families
//     the canonical flag families: trickle, expensive, low_power,
//     interrupted (telemetry_gap). Other deterministic flags
//     (cost_zero, bad_power) MAY be mentioned when present in the
//     tool reply, but the four named families are the headline
//     vocabulary.
//   - Forbids proposing state mutations: the diagnosis narrates,
//     suggests safe-charging habits in plain language, and stops
//     there. It must NOT propose changing alert thresholds,
//     suspending notifications, scheduling charges, or any other
//     write — separation of concerns is enforced at the prompt
//     boundary as defence-in-depth on top of the read-only tool
//     allowlist.
//   - Refuses cross-session or cross-vehicle requests: the AI
//     handler always scopes to the caller-supplied session_id
//     from the URL path, and the diagnosis must refuse to discuss
//     a different session ID even if the user message contains one.
//   - Asks for short, focused output (2-4 short paragraphs) so the
//     surface fits inside the existing ChargingDetailPage layout
//     without a scroll bomb.
const SystemPrompt = `You are the TeslaSync charging diagnosis assistant. ` +
	`Your job is to explain ONE already-completed (or in-progress) charging session in plain language, focusing on any flags the deterministic aggregator already raised: trickle, expensive, low-power, or interrupted (telemetry-gap). ` +
	`ALWAYS call query_charge_session AND query_charging_aggregation FIRST, then answer STRICTLY from their replies — never invent, infer, or estimate facts that are not present in the tool output. ` +
	`Do NOT make per-sample claims like "the power dropped at 14:32"; the tools return session-level aggregates and boolean flags, not per-row telemetry events. ` +
	`Do NOT propose changing alert thresholds, suspending notifications, scheduling charges, or any other state mutation — your role is read-only diagnosis and plain-language explanation. ` +
	`Address the vehicle by its display name when one is provided. ` +
	`Refuse politely if asked to diagnose a different session ID than the one named in the request, or any vehicle other than the one that owns this session. ` +
	`Keep the response to 2-4 short paragraphs covering: the flag(s) raised (or "no anomalies detected" when none are), the deterministic numbers behind them (kWh added, duration, average power, cost per kWh when known), and one practical suggestion per flag the data clearly supports.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `query_charge_session` and
// `query_charging_aggregation` are registered by
// RegisterChargingDiagnosisTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// Charging diagnosis exposes zero mutating tools; it only
// READS already-aggregated session state. A future "draft a
// charge-schedule alert based on this session" strategy that needs
// to write would add its own strategy with its own confirm hook.
var allowedTools = []string{
	"query_charge_session",
	"query_charging_aggregation",
}

// Strategy is the concrete strategy.Strategy implementation for the
// per-charging-session diagnosis. Construct via [New]; the zero value
// is intentionally non-functional so a forgotten constructor surfaces
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
// handler builds the synthesised "diagnose charging session N for
// vehicle M" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "user prefers SI vs US
// units" preference snippet would be injected once charging
// diagnosis grows that surface. Context stays empty
// so the dispatcher's behaviour is fully determined by [System] +
// History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChargingDiagnosis wrapped through the strategy redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Policy contract: "Policy: PolicyDigest from
// internal/ai/redact/policies.go. Allowed classes: ClassVehicleName
// only; charging location names remain tagged by default".
// PolicyChargingDiagnosis is the per-feature constructor with the
// same allow-list as PolicyDigest — kept as a distinct identifier
// so a future per-feature change to charging diagnosis's allow-list
// does not bleed across to the digest or the drive coach.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChargingDiagnosis())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/charging-diagnosis/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
