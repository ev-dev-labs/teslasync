// This file exposes one propose-only tool for the
// vehicle-paint-preview strategy:
//
//   - `draft_paint_preview_prompt` — accept a vehicle_id, a
//     proposed paint color name, and an optional style hint, and
//     return a typed "paint-preview image-prompt" envelope with
//     the vehicle's read-only model / trim / current_color
//     evidence and a deterministic suggested image prompt. The
//     LLM uses this evidence to ground its short narrative reply
//     ("I drafted Midnight Blue…"). PROPOSE-ONLY: nothing is
//     generated, uploaded, or saved; no external image-generation
//     provider is ever called.
//
// Design constraints:
//
//   - "produces preview prompt DTOs for opted-in image provider" —
//     this tool returns only the typed DTO. An actual image-bytes
//     generation call is intentionally out of scope and would
//     land in future wiring that reuses the same
//     propose-only DTO through the same per-feature toggle.
//   - "The LLM never writes raw SQL and never bypasses existing
//     handlers." → the tool delegates the vehicle read to the
//     narrow tools.VehicleSource interface (production:
//     *vehicledb.VehicleRepo, the same read path the GET
//     /api/v1/vehicles handlers already use). No new SQL.
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists here; the evidence is a pure read. The
//     actual paint persistence flows through the existing manual
//     per-vehicle Color setting in VehicleConfigSection /
//     VehicleSettingsTab AFTER the user explicitly clicks Save.
//   - Privacy: the strategy uses redact.PolicyChatbot (allows
//     NOTHING in cleartext); the validator additionally refuses
//     obvious lat/long / street-address-shaped substrings and
//     control characters in the proposed color / style hint as
//     defence-in-depth against an LLM that received cleartext for
//     any reason. The evidence envelope intentionally OMITS the
//     vehicle's display_name and VIN — the LLM is told (system
//     prompt) that it MAY reference model / trim / color but
//     never the display name. Defence-in-depth: the tool simply
//     never hands the display name over.

package paint

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// Hard caps on the typed paint-preview draft fields. Kept here so
// the runtime tool contract and the strategy's system prompt agree.
const (
	paintPreviewMaxColorLen       = 80
	paintPreviewMaxStyleHintLen   = 80
	paintPreviewMaxImagePromptLen = 500
)

// paintPreviewEvidence is the read-only context envelope the
// draft_paint_preview_prompt tool returns alongside the typed
// suggestion. The LLM is expected to ground its narrative reply in
// these fields only — display_name and VIN are intentionally
// excluded so a leaked transcript reveals neither identifier.
type paintPreviewEvidence struct {
	Model        *string `json:"model,omitempty"`
	TrimLevel    *string `json:"trim_level,omitempty"`
	CurrentColor *string `json:"current_color,omitempty"`
}

// paintPreviewDraftInput is the typed input for
// draft_paint_preview_prompt. The LLM passes the vehicle_id
// (required), proposed_color (required), and an optional style_hint.
type paintPreviewDraftInput struct {
	VehicleID     int64  `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID this paint-preview image prompt applies to."`
	ProposedColor string `json:"proposed_color" validate:"required,gte=1,lte=80" desc:"Proposed paint color name (1-80 chars), e.g. 'Midnight Blue'."`
	StyleHint     string `json:"style_hint,omitempty" validate:"omitempty,lte=80" desc:"Optional one-word style hint (e.g. 'studio', 'outdoor', 'sunset'). Cap 80 chars."`
}

// paintPreviewDraftOutput is the JSON envelope
// draft_paint_preview_prompt returns. Suggested is populated on
// Status="ok"; ValidationError is populated on Status="invalid".
type paintPreviewDraftOutput struct {
	Suggested       *paintPreviewSuggestion `json:"suggested,omitempty"`
	Evidence        paintPreviewEvidence    `json:"evidence"`
	Status          string                  `json:"status"`
	ValidationError string                  `json:"validation_error,omitempty"`
	Source          string                  `json:"source"`
}

// paintPreviewSuggestion is the deterministic seed the
// draft_paint_preview_prompt tool returns. The LLM is free to quote
// it back / refine it in its narrative; the seed exists so that an
// LLM that fails to produce any narrative still surfaces a usable
// proposal (defence-in-depth for the no-tool-output failure mode).
type paintPreviewSuggestion struct {
	VehicleID     int64   `json:"vehicle_id"`
	Model         *string `json:"model,omitempty"`
	TrimLevel     *string `json:"trim_level,omitempty"`
	CurrentColor  *string `json:"current_color,omitempty"`
	ProposedColor string  `json:"proposed_color"`
	ImagePrompt   string  `json:"image_prompt"`
	StyleHint     string  `json:"style_hint,omitempty"`
}

// validatePaintPreviewString runs the deterministic per-field paint
// preview validation. Extracted so the tool can reject the LLM's
// proposal byte-equivalent to what a future canonical paint-preview
// save handler would enforce.
//
// Rules (pinned by tests):
//   - non-empty after trim;
//   - no leading / trailing whitespace;
//   - no control characters (Unicode category Cc) anywhere;
//   - within the field's hard cap;
//   - no cleartext lat/long pair;
//   - no obvious "<number> <Word> <Street-type>" street-address
//     pattern.
//
// The lat/long + street-address detectors are shared with the
// share-card validator (tools.ReLatLong, tools.ReStreetAddr in
// share_card_image.go) — defence-in-depth against an LLM that
// received cleartext for any reason.
func validatePaintPreviewString(label, value string, maxLen int) error {
	if value == "" {
		return fmt.Errorf("paint preview %s must not be empty", label)
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("paint preview %s must contain at least one non-whitespace character", label)
	}
	if value[0] == ' ' || value[0] == '\t' ||
		value[len(value)-1] == ' ' || value[len(value)-1] == '\t' {
		return fmt.Errorf("paint preview %s must not have leading or trailing whitespace", label)
	}
	runes := []rune(value)
	if len(runes) > maxLen {
		return fmt.Errorf("paint preview %s must be at most %d characters", label, maxLen)
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return fmt.Errorf("paint preview %s must not contain control characters", label)
		}
	}
	if tools.ReLatLong.MatchString(value) {
		return fmt.Errorf("paint preview %s must not contain precise lat/long coordinates", label)
	}
	if tools.ReStreetAddr.MatchString(value) {
		return fmt.Errorf("paint preview %s must not contain precise street addresses", label)
	}
	return nil
}

// buildPaintPreviewEvidence projects a *vehiclemodel.Vehicle into the
// read-only evidence envelope returned by the tool. Intentionally
// omits DisplayName and VIN — those are PII the LLM must never
// quote, and the redaction policy already strips them; this is
// defence-in-depth at the data plane.
func buildPaintPreviewEvidence(v *vehiclemodel.Vehicle) paintPreviewEvidence {
	return paintPreviewEvidence{
		Model:        v.Model,
		TrimLevel:    v.TrimLevel,
		CurrentColor: v.Color,
	}
}

// buildPaintPreviewSuggestion synthesises a deterministic seed image
// prompt from the vehicle's model / trim / current color + the
// proposed color + the optional style hint. Used so an LLM that
// fails to produce any narrative still surfaces a usable proposal.
func buildPaintPreviewSuggestion(v *vehiclemodel.Vehicle, proposedColor, styleHint string) *paintPreviewSuggestion {
	style := strings.TrimSpace(styleHint)
	if style == "" {
		style = "studio"
	}
	modelTrim := "Tesla vehicle"
	if v.Model != nil && strings.TrimSpace(*v.Model) != "" {
		modelTrim = strings.TrimSpace(*v.Model)
		if v.TrimLevel != nil && strings.TrimSpace(*v.TrimLevel) != "" {
			modelTrim = modelTrim + " " + strings.TrimSpace(*v.TrimLevel)
		}
	}
	imagePrompt := fmt.Sprintf(
		"A %s photograph of a %s rendered in a deep, photo-realistic %s finish, with even reflections and clean studio lighting suitable for a paint-color preview.",
		style, modelTrim, proposedColor,
	)
	if runes := []rune(imagePrompt); len(runes) > paintPreviewMaxImagePromptLen {
		imagePrompt = string(runes[:paintPreviewMaxImagePromptLen])
	}
	return &paintPreviewSuggestion{
		VehicleID:     v.ID,
		Model:         v.Model,
		TrimLevel:     v.TrimLevel,
		CurrentColor:  v.Color,
		ProposedColor: proposedColor,
		ImagePrompt:   imagePrompt,
		StyleHint:     style,
	}
}

// draftPaintPreviewPrompt is the propose-only tool that builds the
// paint-preview image-prompt envelope. It is the ONLY tool the LLM
// is allowed to call (per the strategy's allowedTools whitelist).
//
// Execution is pure: input → typed envelope. No DB write; no SQL;
// no side effects beyond the read of *vehiclemodel.Vehicle used to
// populate the evidence + seed.
type draftPaintPreviewPrompt struct {
	vehicles tools.VehicleSource
}

func (t *draftPaintPreviewPrompt) Name() string { return "draft_paint_preview_prompt" }

func (t *draftPaintPreviewPrompt) Description() string {
	return "Build a paint-preview image-prompt envelope for the given vehicle and proposed paint color. " +
		"PROPOSE-ONLY: nothing is generated, uploaded, or saved. Returns " +
		"{suggested: {vehicle_id, model, trim_level, current_color, proposed_color, image_prompt, style_hint}, " +
		"evidence: {model, trim_level, current_color}, status: ok|invalid, validation_error, source}. " +
		"Call with the vehicle_id you were given AND your proposed paint color name AND an optional style hint."
}

func (t *draftPaintPreviewPrompt) InputSchema() json.RawMessage {
	return tools.CachedSchema(paintPreviewDraftInput{})
}

func (t *draftPaintPreviewPrompt) OutputSchema() json.RawMessage { return nil }

func (t *draftPaintPreviewPrompt) Mutates() bool { return false }

func (t *draftPaintPreviewPrompt) RequiredScope() string { return "" }

func (t *draftPaintPreviewPrompt) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[paintPreviewDraftInput](raw)
}

// Validation failures surface as Status="invalid". A missing vehicle returns an error so the LLM can retry with the correct vehicle_id.
func (t *draftPaintPreviewPrompt) Execute(ctx context.Context, in any) (any, error) {
	input := in.(paintPreviewDraftInput)
	if t.vehicles == nil {
		return nil, errors.New("draft_paint_preview_prompt: no tools.VehicleSource wired")
	}

	vehicle, err := t.vehicles.GetByID(ctx, input.VehicleID)
	if err != nil {
		return nil, err
	}
	if vehicle == nil {
		return nil, errors.New("draft_paint_preview_prompt: vehicle not found")
	}

	evidence := buildPaintPreviewEvidence(vehicle)
	out := &paintPreviewDraftOutput{
		Evidence: evidence,
		Status:   "ok",
		Source:   "validator: internal/ai/tools/paint_preview.go paintPreviewValidator",
	}

	// Per-field validation. The first failure wins so the LLM
	// gets one actionable diagnostic per round-trip.
	if err := validatePaintPreviewString("proposed_color", input.ProposedColor, paintPreviewMaxColorLen); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
		return out, nil
	}
	if input.StyleHint != "" {
		if err := validatePaintPreviewString("style_hint", input.StyleHint, paintPreviewMaxStyleHintLen); err != nil {
			out.Status = "invalid"
			out.ValidationError = err.Error()
			return out, nil
		}
	}

	out.Suggested = buildPaintPreviewSuggestion(vehicle, input.ProposedColor, input.StyleHint)
	return out, nil
}

// VehiclePaintPreviewSources bundles the narrow read interfaces
// RegisterVehiclePaintPreviewTools needs. Mirrors
// [TripPostcardShareCardImageGenerationSources].
//
// Production wiring (router.go) instantiates the production adapter
// (*vehicledb.VehicleRepo); tests substitute deterministic fakes.
type VehiclePaintPreviewSources struct {
	Vehicles tools.VehicleSource
}

// RegisterVehiclePaintPreviewTools installs the vehicle-paint-preview
// tool on r. Called from router.go after the earlier
// tool registrations so the registry's alphabetical Names list grows
// deterministically.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterVehiclePaintPreviewTools(r *tools.Registry, s VehiclePaintPreviewSources) {
	r.Register(&draftPaintPreviewPrompt{vehicles: s.Vehicles})
}
