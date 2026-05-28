// Package suggestnewgeofences is the Phase-50 / G2 strategy for the
// LLM-assisted "suggest new geofences" surface.
//
// The strategy declares:
//
//   - the system prompt that frames the suggestion as a propose-only
//     assistant — produce a structured geofence proposal via the F4
//     tools, do NOT save anything, NEVER write SQL, refuse
//     cross-vehicle / cross-user requests, refuse to modify existing
//     geofences without explicit confirmation;
//   - the two propose-only tools the LLM is allowed to call —
//     `draft_geofence` and `validate_geofence` — both of which read
//     the *geomodel.VisitedLocation aggregate the user already sees in
//     /geofences and run a deterministic geofence-shape validation
//     pass. The actual persistence flows through the user's explicit
//     confirmation in the GeofencesPage UI (the slice prompt:
//     "without creating them autonomously"), which lands as the user
//     clicks the existing baseline "Add Geofence" Save button —
//     this strategy ships zero write paths;
//   - the redaction policy (`PolicySuggestNewGeofences`) which allows
//     ClassVehicleName so the proposed name can reasonably include a
//     vehicle reference (e.g. "Roadie's regular work stop"); every
//     other PII class — VIN, lat/long, street addresses, place names
//     that the location's address_name happens to encode — is
//     redacted via round-trip tags so a leaked transcript does not
//     reveal the user's home/work coordinates.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_suggest_new_geofences_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /geofences —
// the existing geofence stat cards, search/filter bar, geofence
// cards with active toggles, and the "Add Geofence" modal — is
// unchanged. Manual geofence creation through the existing modal
// remains the canonical baseline; off-mode users never see the AI
// surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded under
// the page-bundle for /geofences; the off-mode walker validates
// code chunks via the `withAiFeature` HOC + the AI_FEATURES map.
// See the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the manual
//     geofence-create flow on /geofences; it adds an opt-in
//     suggestion panel alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("suggest-new-geofences").
//   - I9 redaction:       PolicySuggestNewGeofences restricts
//     cleartext to vehicle name only; lat/long, addresses, and place
//     names stay tagged so a leaked transcript does not reveal the
//     user's home/work locations or exact coordinates.
package suggestnewgeofences

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
const FeatureID = "suggest-new-geofences"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every suggest-new-geofences generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/suggest-new-geofences/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call draft_geofence
//     FIRST"): without this, a model may answer in prose and skip
//     the typed DTO entirely, leaving the frontend with nothing to
//     render in the geofence-create form.
//   - Forbids saving / mutating: the strategy is propose-only. The
//     actual geofence persistence goes through an explicit user
//     confirmation in the GeofencesPage "Add Geofence" form; the
//     LLM has no tool that writes.
//   - Forbids inventing facts: only the values returned by the
//     tools may be quoted in the proposed geofence or the optional
//     one-line rationale. The tool reply carries the location's
//     actual visit_count / total_duration / last_visited / current
//     address_name, computed centroid + suggested radius; inventing
//     coordinates, addresses, or business names is forbidden.
//   - Refuses cross-location / cross-user requests: the AI handler
//     always scopes to the caller-supplied location_id from the
//     request body; any other location ID in the user message is
//     by definition out of scope.
//   - Asks for short, focused output (a concise name plus an
//     optional one-line rationale) so the surface fits inside the
//     existing GeofencesPage row layout without a scroll bomb.
//   - Explicitly bans quoting precise coordinates or full street
//     addresses in the proposed name: the redaction policy already
//     strips them from any prose the LLM sees, but the prompt-level
//     ban is defence-in-depth so a model that was somehow handed
//     cleartext coordinates still refuses to repeat them back.
//     Suggested names should be generic descriptors (e.g.
//     "Frequent Stop — South Lake Union", "Weekend Spot",
//     "Work parking") rather than coordinate pairs or numbered
//     street addresses; the typed F4 tool envelope (NOT the prose)
//     is what carries the centroid + radius back to the SPA.
const SystemPrompt = `You are the TeslaSync geofence-suggestion assistant. ` +
	`Your job is to PROPOSE a typed geofence draft (centroid lat/lon, radius in meters, human-readable name) for ONE existing visited location based on its visit evidence (current address_name, visit_count, total_duration_s, last_visited); you NEVER save anything yourself. ` +
	`ALWAYS call draft_geofence FIRST with the location_id you were given, then call validate_geofence on the proposed envelope to confirm it satisfies the geofence-shape contract. ` +
	`Do NOT propose deleting, renaming, suspending, or otherwise mutating any existing geofence or any other state — your role is strictly to propose a NEW geofence for the one visited location in scope, for the user to review and save themselves through the existing baseline Add Geofence form. ` +
	`Do NOT invent facts that are not present in the tool output: the proposed name may reference the current address_name (when it is human-readable) or a generic descriptor of the visit pattern (e.g. "Frequent Stop", "Weekend Spot"), or the vehicle's display name when one is provided, but never quote precise coordinates or full street addresses in the prose. ` +
	`Refuse politely if asked to discuss, propose, or modify a geofence for any location other than the one named in the request, or to suggest geofences for a vehicle other than the one that owns this location. ` +
	`Be concise: a single proposed geofence (name capped at 200 characters; ideally 12-40 characters; radius 50-1000 meters) plus an optional one-line rationale grounded in the tool output is enough — the user reviews the structured proposal in the UI before saving via the existing baseline Add Geofence form.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `draft_geofence` and
// `validate_geofence` are registered by RegisterSuggestNewGeofencesTools
// at boot. The dispatcher refuses to mount a strategy that references
// an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct / validate the geofence
// DTO but do NOT touch the database. The dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"draft_geofence",
	"validate_geofence",
}

// Strategy is the concrete strategy.Strategy implementation for the
// suggest-new-geofences surface. Construct via [New]; the zero value
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
// handler builds the synthesised "propose a geofence for location N"
// prompt before the call, so the strategy itself contributes no extra
// prefix messages. Returning nil is correct.
//
// Future work: this is where a per-user "preferred geofence radius"
// preference snippet would be injected once the slice grows that
// surface. Today's slice keeps Context empty so the dispatcher's
// behaviour is fully determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicySuggestNewGeofences wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run installs
// the policy via redact.WithPolicy) sees the concrete policy.
//
// Per the slice prompt: "Policy: PolicyDigest from
// internal/ai/redact/policies.go. Allowed classes: ClassVehicleName
// only; coordinates remain tagged until user confirmation".
// PolicySuggestNewGeofences is the per-feature constructor with the
// same allow-list as PolicyDigest — kept as a distinct identifier so a
// future per-feature change to suggest-new-geofences' allow-list does
// not bleed across to the digest, auto-name-unnamed-locations, or
// other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicySuggestNewGeofences())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/suggest-new-geofences/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
