// Package drivecoaching is the Phase-50 / N4 strategy for the
// LLM-narrated per-drive coaching narrative.
//
// The strategy declares:
//
//   - the system prompt that frames the narration as a calm, factual
//     coaching summary of ONE already-completed drive — never invents
//     samples, never proposes mutations, never generalises across
//     drives or vehicles;
//   - the two read-only tools the LLM is allowed to call —
//     `query_drive_detail` (existing builtin; one *drivemodel.Drive by ID)
//     and `query_drive_telemetry_summary` (new in this slice; a
//     deterministic envelope of pre-aggregated drive metrics derived
//     from the same *drivemodel.Drive row, exposing coaching-friendly
//     derived fields such as regen_share_pct and kwh_per_100km);
//   - the redaction policy (`PolicyDriveCoaching`) which allows
//     ClassVehicleName so the narration can address the user's car by
//     name; lat/long, addresses, VINs, etc. are redacted via
//     round-trip tags.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_drive_coach_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /drives/:id —
// existing drive stat cards, hero gauges, energy summary, and other
// deterministic panels assembled by DriveDetailPage — is unchanged.
// Off-mode users never see the AI surface at all (ADR-015 §I3, §I5,
// §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces DriveDetailPage's
//     deterministic stat cards or charts; it adds an
//     opt-in narrative panel alongside.
//   - I7 per-feature:     the AI route is gated by guard.Wrap("drive-coaching").
//   - I9 redaction:       PolicyDriveCoaching restricts cleartext to
//     vehicle name only; lat/long and addresses
//     stay tagged so a leaked transcript does not
//     reveal the user's home/work locations.
package drivecoaching

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
const FeatureID = "drive-coaching"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every coaching narration. Kept in a single named place
// so eval goldens
// (internal/ai/strategies/drive-coaching/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call query_drive_detail
//     AND query_drive_telemetry_summary FIRST"): without this, a
//     model may answer from priors and hallucinate driving habits
//     the deterministic aggregates do not actually surface.
//   - Forbids inventing facts: only the values returned by the tools
//     may be quoted. Per-sample ("you accelerated hard at 14:32")
//     statements are forbidden because the tools return aggregates,
//     not per-row telemetry events.
//   - Forbids proposing state mutations: the coach narrates,
//     suggests safe driving habits in plain language, and stops
//     there. It must NOT propose changing alert thresholds,
//     suspending notifications, scheduling charges, or any other
//     write — separation of concerns is enforced at the prompt
//     boundary as defence-in-depth on top of the read-only tool
//     allowlist.
//   - Refuses cross-vehicle or cross-drive requests: the AI handler
//     always scopes to the caller-supplied drive_id, and the
//     narration must refuse to discuss a different drive ID even if
//     the user message contains one.
//   - Asks for short, focused output (2-4 short paragraphs) so the
//     surface fits inside the existing DriveDetailPage layout
//     without a scroll bomb.
const SystemPrompt = `You are the TeslaSync drive coach. ` +
	`Your job is to narrate ONE already-completed drive in plain language, suggesting safer or more efficient driving habits where the data supports it. ` +
	`ALWAYS call query_drive_detail AND query_drive_telemetry_summary FIRST, then answer STRICTLY from their replies — never invent, infer, or estimate facts that are not present in the tool output. ` +
	`Do NOT make per-sample claims like "you braked hard at 14:32"; the tools return drive-level aggregates, not per-row telemetry events. ` +
	`Do NOT propose changing alert thresholds, suspending notifications, scheduling charges, or any other state mutation — your role is read-only narration and coaching. ` +
	`Address the vehicle by its display name when one is provided. ` +
	`Refuse politely if asked to discuss a different drive ID than the one named in the request, or any vehicle other than the one that owns this drive. ` +
	`Keep the response to 2-4 short paragraphs covering: distance/duration, energy use including regen share, and one or two coaching observations the data clearly supports.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — `query_drive_detail` is a builtin
// (registered by Register12Builtins) and `query_drive_telemetry_summary`
// is registered by RegisterDriveCoachingTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// This slice ships zero mutating tools: drive coaching only READS
// already-aggregated drive state. A future "schedule a maintenance
// reminder based on this drive" strategy that needs to write would
// add its own strategy with its own confirm hook.
var allowedTools = []string{
	"query_drive_detail",
	"query_drive_telemetry_summary",
}

// Strategy is the concrete strategy.Strategy implementation for the
// per-drive coaching narrative. Construct via [New]; the zero value
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
// handler builds the synthesised "coach drive N for vehicle M"
// prompt before the call, so the strategy itself contributes no
// extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "user prefers SI vs US
// units" preference snippet would be injected once drive coaching
// grows that surface. Today's slice keeps Context empty so the
// dispatcher's behaviour is fully determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyDriveCoaching wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the slice prompt: "Policy: PolicyDigest from
// internal/ai/redact/policies.go. Allowed classes: ClassVehicleName
// only; route/location details stay tagged unless explicitly
// restored to same user". PolicyDriveCoaching is the per-feature
// constructor with the same allow-list as PolicyDigest — kept as a
// distinct identifier so a future per-feature change to drive
// coaching's allow-list does not bleed across to the digest.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyDriveCoaching())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/drive-coaching/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
