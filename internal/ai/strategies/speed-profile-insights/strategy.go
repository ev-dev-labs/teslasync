// Package speedprofileinsights implements the LLM-narrated per-drive
// speed-profile insights surface.
//
// The strategy declares:
//
//   - the system prompt that frames the narration as a calm, factual
//     overview of ONE already-completed drive's speed regime — never
//     invents per-sample events, never proposes mutations, never
//     generalises across drives or vehicles;
//   - the two read-only tools the LLM is allowed to call —
//     `query_speed_profile` (returns SI aggregates plus a derived
//     speed regime classification from the existing *drivemodel.Drive
//     row) and `query_drive_context` (returns the drive's temporal +
//     battery + temperature envelope from the SAME *drivemodel.Drive
//     row);
//   - the redaction policy (`PolicySpeedProfileInsights`) which
//     allows ClassVehicleName so the narration can address the
//     user's car by name; lat/long, addresses, VINs, etc. are
//     redacted via round-trip tags so a leaked transcript does not
//     reveal the user's route geometry.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_speed_profile_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /drives/:id —
// existing SpeedHistogramChart, summary stat cards, hero gauges,
// energy summary, and other deterministic panels assembled by
// DriveDetailPage — is unchanged. Off-mode users never see the AI
// surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this frontend code is loaded under the
// page-bundle for /drives/:id. RouteSet has no ServiceWorkerChunks
// field; the off-mode walker validates code chunks through the
// `withAiFeature` HOC and AI_FEATURES map.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces DriveDetailPage's
//     SpeedHistogramChart or summary metrics; it adds an
//     opt-in narrative panel alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("speed-profile-insights").
//   - I9 redaction:       PolicySpeedProfileInsights restricts cleartext to
//     vehicle name only; lat/long and addresses
//     stay tagged so a leaked transcript does not
//     reveal the user's home/work locations or
//     exact route geometry.
package speedprofileinsights

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
const FeatureID = "speed-profile-insights"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every speed-profile-insights narration. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/speed-profile-insights/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call query_speed_profile
//     AND query_drive_context FIRST"): without this, a model may
//     answer from priors and hallucinate speed habits the
//     deterministic aggregates do not actually surface.
//   - Forbids inventing facts: only the values returned by the
//     tools may be quoted. Per-sample ("you hit 90 mph at 14:32")
//     statements are forbidden because the tools return aggregates,
//     not per-row telemetry events.
//   - Forbids proposing state mutations: the insights narrate the
//     speed regime, mention efficiency observations the data
//     supports, and stop there. They must NOT propose changing
//     alert thresholds, suspending notifications, scheduling
//     charges, or any other write — separation of concerns is
//     enforced at the prompt boundary as defence-in-depth on top of
//     the read-only tool allowlist.
//   - Refuses cross-vehicle or cross-drive requests: the AI handler
//     always scopes to the caller-supplied drive_id, and the
//     narration must refuse to discuss a different drive ID even if
//     the user message contains one.
//   - Asks for short, focused output (2-4 short paragraphs) so the
//     surface fits inside the existing DriveDetailPage layout
//     without a scroll bomb.
//   - Explicitly bans quoting precise route coordinates or full
//     street addresses: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth so a model that
//     was somehow handed cleartext route data still refuses to
//     repeat it back.
const SystemPrompt = `You are the TeslaSync speed-profile analyst. ` +
	`Your job is to narrate the speed regime of ONE already-completed drive in plain language, calling out the dominant speed bucket, outliers, and one or two efficiency or route-context observations the data supports. ` +
	`ALWAYS call query_speed_profile AND query_drive_context FIRST, then answer STRICTLY from their replies — never invent, infer, or estimate facts that are not present in the tool output. ` +
	`Do NOT make per-sample claims like "you hit 95 mph at 14:32"; the tools return drive-level aggregates, not per-row telemetry events. ` +
	`Do NOT propose changing alert thresholds, suspending notifications, scheduling charges, or any other state mutation — your role is read-only narration. ` +
	`Do NOT quote precise route coordinates or full street addresses even if the tool output appears to contain them; describe regions or route character only in general terms. ` +
	`Address the vehicle by its display name when one is provided. ` +
	`Refuse politely if asked to discuss a different drive ID than the one named in the request, or any vehicle other than the one that owns this drive. ` +
	`Keep the response to 2-4 short paragraphs covering: speed regime (city/suburban/highway/high-speed), average and max speed in SI plus a familiar unit, and one or two efficiency or context observations.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `query_speed_profile` and
// `query_drive_context` are registered by
// RegisterSpeedProfileInsightsTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// This strategy ships zero mutating tools: speed-profile insights only
// READS already-aggregated drive state from the same *drivemodel.Drive
// row the deterministic chart already renders from. A future
// "schedule a maintenance reminder based on this drive" strategy
// that needs to write would add its own strategy with its own
// confirm hook.
var allowedTools = []string{
	"query_speed_profile",
	"query_drive_context",
}

// Strategy is the concrete strategy.Strategy implementation for the
// per-drive speed-profile insights narrative. Construct via [New];
// the zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
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
// handler builds the synthesised "narrate speed profile for drive N
// on vehicle M" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "user prefers SI vs US
// units" preference snippet would be injected once speed-profile
// insights grows that surface. Today's strategy keeps Context empty so
// the dispatcher's behaviour is fully determined by [System] +
// History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicySpeedProfileInsights wrapped through the redaction adapter so
// the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees the
// concrete policy.
//
// PolicySpeedProfileInsights allows only ClassVehicleName in cleartext;
// precise route coordinates remain tagged. It is the per-feature constructor with
// the same allow-list as PolicyDigest — kept as a distinct
// identifier so a future per-feature change to speed-profile
// insights's allow-list does not bleed across to the digest or
// drive coaching.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicySpeedProfileInsights())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/speed-profile-insights/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
