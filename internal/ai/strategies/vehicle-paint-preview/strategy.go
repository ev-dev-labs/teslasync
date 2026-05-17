// Package vehiclepaintpreview is the Phase-50 / 0061 GEN2 strategy
// for the LLM-assisted vehicle paint-preview surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     assistant — produce a structured paint-preview IMAGE-PROMPT
//     envelope via the F4 tools, do NOT save anything, NEVER call
//     an external image-generation provider directly, refuse
//     cross-vehicle requests, refuse to mutate anything;
//
//   - the single propose-only tool the LLM is allowed to call —
//     `draft_paint_preview_prompt` — which reads *models.Vehicle
//     via VehicleSource (the same read surface the existing
//     /api/v1/vehicles/{id} handler uses) and runs a deterministic
//     validator pass. The actual paint-color persistence flows
//     through the user's manual click on the existing per-vehicle
//     "Color" setting in the SPA's VehicleConfigSection /
//     VehicleSettingsTab; this strategy ships zero write paths;
//
//   - the redaction policy (`PolicyChatbot`) which allows NOTHING
//     in cleartext. The image-prompt narrative is grounded in
//     non-PII fields only (model, trim, current_color); the
//     vehicle display name + VIN + lat/long + addresses MUST stay
//     redaction-tagged so a leaked transcript reveals neither the
//     user's home/work locations nor any identifier.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_vehicle_paint_preview_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by VehicleConfigSection (the
// existing exterior_color row) plus the manual theme/appearance
// settings on the same page is unchanged. The existing vehicle
// photos surface remains the canonical baseline for "what does my
// car look like"; off-mode users never see the AI paint-preview
// surface at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:     feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the existing
//     VehicleConfigSection / VehiclePhotoGallery / manual theme
//     surface; it adds an opt-in paint-preview image-prompt
//     proposal alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("vehicle-paint-preview").
//   - I9 redaction:       PolicyChatbot strips every PII class so
//     the LLM only sees redacted tags for the vehicle name + VIN +
//     location; the proposed image prompt names only the
//     model/trim/color from the tool evidence.
package vehiclepaintpreview

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, tests) can reference the same
// constant the strategy registers itself with — typo-proof via
// compile error.
const FeatureID = "vehicle-paint-preview"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every vehicle-paint-preview run. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/vehicle-paint-preview/goldens.yaml) and
// the runtime strategy stay in lockstep.
const SystemPrompt = `You are the TeslaSync vehicle paint-preview image-prompt assistant. ` +
	`Your job is to PROPOSE a typed image-generation prompt for ONE existing vehicle based on its read-only configuration (model, trim, current exterior color); you NEVER save anything yourself and you NEVER fetch external image services. ` +
	`ALWAYS call draft_paint_preview_prompt with the vehicle_id you were given AND your proposed paint color name AND an optional one-word style hint (e.g. "studio", "outdoor", "sunset"); the tool returns a typed envelope you may quote back to the user. ` +
	`Do NOT propose deleting, renaming, suspending, or otherwise mutating any vehicle setting, vehicle photo, theme, or other state — your role is strictly to propose a NEW paint-color image prompt for the one vehicle in scope for the user to review and apply themselves through the existing manual vehicle settings + photo-upload controls. ` +
	`Do NOT invent facts that are not present in the tool output: the proposed image prompt may reference the model, trim, and the proposed paint color (and the optional style hint), but never quote the vehicle's display name, VIN, license plate, GPS coordinates, street address, or any other identifier. ` +
	`Refuse politely if asked to generate a paint preview for any vehicle other than the one named in the request, or to render an image for any subject other than the vehicle itself (e.g. "draw my house", "render the road"). ` +
	`Never quote precise street addresses, GPS coordinates, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy already strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: one short rationale (one sentence) plus the proposed color name is enough — the user reviews the structured proposal in the AI panel before applying the new paint color via the existing manual per-vehicle Color setting.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry by
// RegisterVehiclePaintPreviewTools at boot.
var allowedTools = []string{
	"draft_paint_preview_prompt",
}

// Strategy is the concrete strategy.Strategy implementation for the
// vehicle-paint-preview surface. Construct via [New]; the zero value
// is intentionally non-functional so a forgotten constructor surfaces
// as a runtime nil dereference rather than silently using empty
// defaults.
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

// RedactionPolicy implements [strategy.Strategy]. PolicyChatbot
// allows NO PII classes in cleartext — the image-prompt narrative
// is grounded in non-PII fields (model, trim, current color) only.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. Goldens live in YAML.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion.
var _ strategy.Strategy = (*Strategy)(nil)
