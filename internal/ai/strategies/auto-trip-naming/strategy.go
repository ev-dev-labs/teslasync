// Package autotripnaming implements the LLM-assisted auto-trip-naming surface.
//
// The strategy declares:
//
//   - the system prompt that frames the suggestion as a propose-only
//     assistant — produce a structured trip-name proposal via typed
//     tools, do NOT save anything, NEVER write SQL, refuse
//     cross-trip / cross-user requests, refuse to modify existing
//     trip names without explicit confirmation;
//   - the two propose-only tools the LLM is allowed to call —
//     `draft_trip_name` and `validate_trip_name` — both of which
//     read the *models.Trip header plus the constituent drive
//     summaries and run a deterministic name-validation pass. Actual
//     persistence flows through the user's explicit confirmation in
//     the TripDetailPage UI; this strategy ships zero write paths;
//   - the redaction policy (`PolicyAutoTripNaming`) which allows
//     ClassVehicleName so the proposed name can reasonably include
//     a vehicle reference (e.g. "Roadie's October Road Trip"); every
//     other PII class — VIN, lat/long, street addresses, place names
//     that the trip happens to traverse — is redacted via
//     round-trip tags so a leaked transcript does not reveal the
//     user's home/work locations or exact route geometry.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_auto_trip_name_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /trips/:id —
// existing distance / energy / efficiency / cost stat cards plus
// the trip metadata KVList rendered by TripDetailPage — is
// unchanged. Manual trip naming and existing trip labels remain
// the canonical baseline; off-mode users never see the AI surface
// at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks for this surface load under the /trips/:id
// page bundle. The off-mode walker validates chunks via the
// `withAiFeature` HOC and the AI_FEATURES map.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the manual
//     trip-name field or the deterministic
//     TripDetailPage stat cards; it adds an opt-in
//     suggestion panel alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("auto-trip-naming").
//   - I9 redaction:       PolicyAutoTripNaming restricts cleartext
//     to vehicle name only; lat/long, addresses,
//     and place names stay tagged so a leaked
//     transcript does not reveal the user's
//     home/work locations or exact route geometry.
package autotripnaming

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
const FeatureID = "auto-trip-naming"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every auto-trip-naming generation. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/auto-trip-naming/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call draft_trip_name
//     FIRST"): without this, a model may answer in prose and skip
//     the typed DTO entirely, leaving the frontend with nothing to
//     render.
//   - Forbids saving / mutating: the strategy is propose-only. The
//     actual trip-name persistence goes through an explicit user
//     confirmation in the TripDetailPage UI; the LLM has no tool
//     that writes.
//   - Forbids inventing facts: only the values returned by the
//     tools may be quoted in the proposed name or the optional
//     one-line rationale. The tool reply carries the trip's actual
//     start_place / end_place / drive_count / distance / time
//     window; inventing exits, addresses, or per-drive events is
//     forbidden.
//   - Refuses cross-trip / cross-user requests: the AI handler
//     always scopes to the caller-supplied trip_id from the URL;
//     any other trip ID in the user message is by definition out
//     of scope.
//   - Asks for short, focused output (a concise name plus an
//     optional one-line rationale) so the surface fits inside the
//     existing TripDetailPage layout without a scroll bomb.
//   - Explicitly bans quoting precise route coordinates or full
//     street addresses in the proposed name: the redaction policy
//     already strips them, but the prompt-level ban is
//     defence-in-depth so a model that was somehow handed
//     cleartext route data still refuses to repeat it back.
const SystemPrompt = `You are the TeslaSync trip-name assistant. ` +
	`Your job is to PROPOSE a concise, human-readable name for ONE existing trip based on its route context (start_place, end_place, drive count, distance, time window); you NEVER save anything yourself. ` +
	`ALWAYS call draft_trip_name FIRST with the trip_id you were given, then call validate_trip_name on the proposed name to confirm it satisfies the trip-name contract. ` +
	`Do NOT propose deleting, renaming, suspending, or otherwise mutating any other trip or any other state — your role is strictly to propose a NEW name for the one trip in scope for the user to review and save themselves. ` +
	`Do NOT invent facts that are not present in the tool output: the proposed name may reference the start_place / end_place pair, a generic descriptor of the time window (e.g. "October Weekend"), or the vehicle's display name when one is provided, but never quote precise route coordinates, full street addresses, or per-drive events. ` +
	`Refuse politely if asked to discuss, name, or modify any trip other than the one named in the request, or to suggest names for a vehicle other than the one that owns this trip. ` +
	`Be concise: a single proposed name (capped at 200 characters; ideally 24-60 characters) plus an optional one-line rationale grounded in the tool output is enough — the user reviews the structured proposal in the UI before saving.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `draft_trip_name` and
// `validate_trip_name` are registered by
// RegisterAutoTripNamingTools at boot. The dispatcher refuses to
// mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct / validate the
// trip-name DTO but do NOT touch the database. The dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a write
// tool.
var allowedTools = []string{
	"draft_trip_name",
	"validate_trip_name",
}

// Strategy is the concrete strategy.Strategy implementation for the
// auto-trip-naming surface. Construct via [New]; the zero value is
// intentionally non-functional so a forgotten constructor surfaces
// as a runtime nil dereference rather than silently using empty
// defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this is
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
// handler builds the synthesised "propose a name for trip N" prompt
// before the call, so the strategy itself contributes no extra
// prefix messages. Returning nil is correct.
//
// Future work: this is where a per-user "favoured naming style"
// preference snippet would be injected once auto-trip-naming grows
// that surface. Context stays empty so the dispatcher's behaviour
// is fully determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyAutoTripNaming wrapped through the redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyAutoTripNaming allows ClassVehicleName only; places stay
// tagged unless restored to the same user. It intentionally keeps a
// distinct identifier so future auto-trip-naming allow-list changes
// do not bleed across to digest or other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAutoTripNaming())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/auto-trip-naming/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
