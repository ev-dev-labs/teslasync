// Package trippostcardsharecardimagegeneration is the Phase-50 /
// 0060 GEN1 strategy for the LLM-assisted trip-postcard /
// share-card image-generation surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     assistant — produce a structured IMAGE-PROMPT envelope plus
//     a typed share-card preview shape via the F4 tools, do NOT
//     save anything, NEVER call an external image-generation
//     provider directly (the surface returns a typed prompt the
//     user reviews; an actual image-generation provider call is
//     out of scope for this slice and would land in a future
//     wiring slice that re-uses the same propose-only DTOs),
//     refuse cross-trip / cross-user requests, refuse to mutate
//     anything;
//
//   - the two propose-only tools the LLM is allowed to call —
//     `draft_image_prompt` and `render_share_card_preview` —
//     both of which read *models.Trip + the constituent drive
//     summaries via TripDetailSource and run deterministic
//     validation passes. The actual persistence flows through
//     the user's explicit confirmation in the SharingTripsPage
//     UI (the user clicks an existing share-card button to copy
//     the suggestion); this strategy ships zero write paths;
//
//   - the redaction policy (`PolicyDigest`) which allows
//     ClassVehicleName so the proposed share-card copy can
//     reasonably reference the user's car ("Roadie's October
//     Road Trip"). Every other PII class — VIN, lat/long, street
//     addresses, place names that the trip happens to traverse
//     — is redacted via round-trip tags so a leaked transcript
//     does not reveal the user's home/work locations or exact
//     route geometry.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_trip_postcard_share_card_image_handler.go`
// which builds a dispatcher, a stream.Writer (SSE), and runs a
// one-shot generation loop. The non-AI baseline rendered by the
// existing public /s/:token shared-drive route (SharedDrivePage)
// plus the deterministic share-link controls on the authenticated
// /sharing/trips authoring page — generate static link, copy
// link, list active links, revoke — is unchanged. Static share
// cards and existing screenshots remain the canonical baseline;
// off-mode users never see the AI surface at all
// (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the existing
//     static share-card / shared-drive report; it adds an opt-in
//     image-prompt + share-card-preview proposal alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("trip-postcard-share-card-image-generation").
//   - I9 redaction:       PolicyDigest restricts cleartext to vehicle
//     name only; lat/long, addresses, and place names stay tagged so a
//     leaked transcript does not reveal the user's home/work locations
//     or exact route geometry.
package trippostcardsharecardimagegeneration

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
const FeatureID = "trip-postcard-share-card-image-generation"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every trip-postcard / share-card image-generation
// run. Kept in a single named place so eval goldens
// (internal/ai/strategies/trip-postcard-share-card-image-generation/
// goldens.yaml) and the runtime strategy stay in lockstep.
const SystemPrompt = `You are the TeslaSync trip postcard / share-card image-prompt assistant. ` +
	`Your job is to PROPOSE a typed image-generation prompt plus a typed share-card preview for ONE existing trip based on its route context (start_place, end_place, drive count, distance, time window); you NEVER save anything yourself and you NEVER fetch external image services. ` +
	`ALWAYS call draft_image_prompt FIRST with the trip_id you were given, then call render_share_card_preview on the proposed draft to confirm it satisfies the share-card contract. ` +
	`Do NOT propose deleting, renaming, suspending, or otherwise mutating any share link, trip, or other state — your role is strictly to propose a NEW share-card image prompt for the one trip in scope for the user to review and apply themselves through the existing manual share-link controls. ` +
	`Do NOT invent facts that are not present in the tool output: the proposed share-card title, subtitle, and image prompt may reference the start_place / end_place pair, a generic descriptor of the time window (e.g. "October Weekend"), or the vehicle's display name when one is provided, but never quote precise route coordinates, full street addresses, or per-drive events. ` +
	`Refuse politely if asked to discuss, propose, or modify a share card for any trip other than the one named in the request, or to generate prompts for a vehicle other than the one that owns this trip. ` +
	`Never quote precise street addresses, GPS coordinates, place-name strings beyond a generic city / region pair, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy already strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: a single short share-card title (capped at 100 characters; ideally 24-60), an optional one-line rationale, and one image-generation prompt (capped at 500 characters) is enough — the user reviews the structured proposal in the UI before applying it.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `draft_image_prompt` and
// `render_share_card_preview` are registered by
// RegisterTripPostcardShareCardImageGenerationTools at boot.
var allowedTools = []string{
	"draft_image_prompt",
	"render_share_card_preview",
}

// Strategy is the concrete strategy.Strategy implementation for the
// trip-postcard-share-card-image-generation surface. Construct via
// [New]; the zero value is intentionally non-functional so a
// forgotten constructor surfaces as a runtime nil dereference
// rather than silently using empty defaults.
type Strategy struct{}

// New constructs the strategy.
func New() *Strategy { return &Strategy{} }

// FeatureID implements [strategy.Strategy].
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy].
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. No extra prefix messages.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy].
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyDigest())
}

// EvalGoldens implements [strategy.Strategy]. Goldens live in YAML.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion.
var _ strategy.Strategy = (*Strategy)(nil)
