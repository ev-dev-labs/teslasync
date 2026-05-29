// Trip postcard and share-card image generation exposes two
// propose-only tools used by the
// trip-postcard-share-card-image-generation strategy
// (internal/ai/strategies/trip-postcard-share-card-image-generation):
//
//   - `draft_image_prompt`         — accept a trip_id plus an optional
//                                    style_hint and return a typed
//                                    "share-card image-prompt seed"
//                                    envelope with the trip's read-only
//                                    route evidence (start_place,
//                                    end_place, drive_count, distance,
//                                    time window) the LLM uses to
//                                    ground its follow-up image
//                                    prompt + title.
//   - `render_share_card_preview`  — accept a trip_id + the LLM's
//                                    proposed share-card title, image
//                                    prompt, and style/palette hints
//                                    and report whether the proposal
//                                    satisfies the share-card contract
//                                    (lengths, no control chars, no
//                                    obvious lat/long / street-address
//                                    leakage in cleartext, no claims
//                                    of having shared/saved/published
//                                    anything). Both tools are
//                                    propose-only: they construct or
//                                    validate share-card image-prompt
//                                    DTOs but do NOT touch the
//                                    database, never call an external
//                                    image provider, and never persist
//                                    anything.
//
// Design constraints:
//
//   - "produces image prompt DTOs and invokes configured image
//     provider only when enabled" — this feature ships only the typed
//     DTO. An actual provider call (image bytes generation) is out
//     of scope here and would land in future wiring that reuses the
//     same propose-only DTOs through the
//     same per-feature toggle.
//   - "The LLM never writes raw SQL and never bypasses existing
//     handlers." → both tools delegate read of the trip detail to a
//     narrow TripDetailSource interface (production:
//     *tripdb.TripsDetailRepo, the same read path the GET
//     /api/v1/trips/{id} baseline handler already uses).
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists here; the evidence is a pure read.
//   - Privacy: the strategy uses redact.PolicyDigest (allow
//     ClassVehicleName only); the validator in render_share_card_preview
//     additionally refuses obvious lat/long / street-address-shaped
//     substrings in the proposed title or image_prompt as
//     defence-in-depth against an LLM that received cleartext for
//     any reason.

package trip

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
)

// Hard caps on the typed share-card draft fields. The values mirror
// the narrative caps ("a single short share-card
// title capped at 100 characters and one image-generation prompt
// capped at 500 characters, so the
// runtime contract and the system prompt agree.
const (
	shareCardMaxTitleLen       = 100
	shareCardMaxSubtitleLen    = 200
	shareCardMaxImagePromptLen = 500
	shareCardMaxStyleHintLen   = 80
	shareCardMaxPaletteHintLen = 80
)

// shareCardImageEvidence is the read-only context envelope the
// share-card-image tools return alongside the typed draft / preview.
// The LLM is expected to ground its title + image prompt in these
// fields. Numeric units are SI-canonical (meters, seconds); the
// frontend converts to user-preferred display units at the render
// boundary.
type shareCardImageEvidence struct {
	StartPlace  *string `json:"start_place,omitempty"`
	EndPlace    *string `json:"end_place,omitempty"`
	DriveCount  int64   `json:"drive_count"`
	DistanceM   float64 `json:"distance_m"`
	DurationS   int64   `json:"duration_s"`
	EnergyWh    float64 `json:"energy_wh"`
	StartedAt   string  `json:"started_at"`
	EndedAt     string  `json:"ended_at,omitempty"`
	CurrentName string  `json:"current_name,omitempty"`
}

// shareCardImageDraftInput is the typed input for draft_image_prompt.
// The LLM passes only the trip_id (required) and an optional
// style_hint; the tool returns a seed envelope including evidence
// and a deterministic suggested title the LLM can refine in its
// follow-up render_share_card_preview call.
type shareCardImageDraftInput struct {
	TripID    int64  `json:"trip_id" validate:"required,gte=1" desc:"Numeric trip ID this share-card image prompt applies to."`
	StyleHint string `json:"style_hint,omitempty" validate:"omitempty,lte=80" desc:"Optional free-text style hint (e.g. 'vintage', 'panoramic', 'minimalist'). Cap 80 chars."`
}

// shareCardImageDraftOutput is the JSON envelope draft_image_prompt
// returns. The Suggested field is a deterministic seed the LLM can
// quote back / refine; the Evidence field grounds the LLM's
// subsequent free-text title + image prompt.
type shareCardImageDraftOutput struct {
	Suggested *shareCardImageSuggestion `json:"suggested"`
	Evidence  shareCardImageEvidence    `json:"evidence"`
	Status    string                    `json:"status"`
	Source    string                    `json:"source"`
}

// shareCardImageSuggestion is the deterministic seed the
// draft_image_prompt tool returns. The LLM is free to refine it in
// the subsequent render_share_card_preview call; the seed exists
// so that an LLM that fails to produce any narrative still surfaces
// a usable proposal (defence-in-depth for the no-tool-output
// failure mode).
type shareCardImageSuggestion struct {
	TripID        int64  `json:"trip_id"`
	VehicleID     int64  `json:"vehicle_id"`
	ProposedTitle string `json:"proposed_title"`
	ImagePrompt   string `json:"image_prompt"`
	StyleHint     string `json:"style_hint,omitempty"`
}

// shareCardImagePreviewInput is the typed input for
// render_share_card_preview. The LLM passes the trip_id (required),
// its proposed share-card title + image prompt (required), and
// optional style/palette hints. The tool validates the proposed
// shape against the share-card contract and returns a render-ready
// envelope (or status=invalid with a diagnostic).
type shareCardImagePreviewInput struct {
	TripID        int64  `json:"trip_id" validate:"required,gte=1" desc:"Numeric trip ID this preview applies to."`
	ProposedTitle string `json:"proposed_title" validate:"required,gte=1,lte=100" desc:"Proposed share-card title (1-100 chars)."`
	ImagePrompt   string `json:"image_prompt" validate:"required,gte=1,lte=500" desc:"Proposed image-generation prompt (1-500 chars)."`
	Subtitle      string `json:"subtitle,omitempty" validate:"omitempty,lte=200" desc:"Optional one-line subtitle (<= 200 chars)."`
	StyleHint     string `json:"style_hint,omitempty" validate:"omitempty,lte=80" desc:"Optional style hint (<= 80 chars)."`
	PaletteHint   string `json:"palette_hint,omitempty" validate:"omitempty,lte=80" desc:"Optional palette hint (<= 80 chars)."`
}

// shareCardImagePreviewOutput is the envelope render_share_card_preview
// returns. Preview is populated on Status="ok"; ValidationError is
// populated on Status="invalid".
type shareCardImagePreviewOutput struct {
	Preview         *shareCardImagePreview `json:"preview,omitempty"`
	Evidence        shareCardImageEvidence `json:"evidence"`
	Status          string                 `json:"status"`
	ValidationError string                 `json:"validation_error,omitempty"`
	Source          string                 `json:"source"`
}

// shareCardImagePreview is the render-ready share-card envelope.
// The frontend renders this in the AI side panel; the user
// reviews + (optionally edits) before applying via the existing
// manual share-link controls in the SharingTripsPage UI.
type shareCardImagePreview struct {
	TripID        int64  `json:"trip_id"`
	VehicleID     int64  `json:"vehicle_id"`
	ProposedTitle string `json:"proposed_title"`
	Subtitle      string `json:"subtitle,omitempty"`
	ImagePrompt   string `json:"image_prompt"`
	StyleHint     string `json:"style_hint,omitempty"`
	PaletteHint   string `json:"palette_hint,omitempty"`
}

// Heuristic detectors for cleartext PII the redaction policy is
// supposed to strip but the validator should still refuse if it
// somehow reaches the tool input. Defence-in-depth per ADR-015 §I9
// and the prompt's "Never quote precise street addresses, GPS
// coordinates" clause.
//
// The patterns intentionally err on the side of false positives —
// the LLM can re-issue with a tag-style reference or a generic
// city / region pair; better a refused preview than a leaked
// address in the user's clipboard.

// validateShareCardImageString runs the deterministic per-field
// share-card validation. Extracted so the tool can reject the LLM's
// proposal byte-equivalent to what a future canonical share-card
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
func validateShareCardImageString(label, value string, maxLen int) error {
	if value == "" {
		return fmt.Errorf("share-card %s must not be empty", label)
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("share-card %s must contain at least one non-whitespace character", label)
	}
	if value[0] == ' ' || value[0] == '\t' || value[len(value)-1] == ' ' || value[len(value)-1] == '\t' {
		return fmt.Errorf("share-card %s must not have leading or trailing whitespace", label)
	}
	runes := []rune(value)
	if len(runes) > maxLen {
		return fmt.Errorf("share-card %s must be at most %d characters", label, maxLen)
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return fmt.Errorf("share-card %s must not contain control characters", label)
		}
	}
	if tools.ReLatLong.MatchString(value) {
		return fmt.Errorf("share-card %s must not contain precise lat/long coordinates", label)
	}
	if tools.ReStreetAddr.MatchString(value) {
		return fmt.Errorf("share-card %s must not contain precise street addresses", label)
	}
	return nil
}

// buildShareCardImageEvidence converts the *tripdb.TripDetail
// header into the read-only evidence envelope returned by both
// tools. ISO-8601 UTC strings so the LLM's follow-up prose can
// quote the dates back to the user without ambiguity.
func buildShareCardImageEvidence(detail *tripdb.TripDetail) shareCardImageEvidence {
	ev := shareCardImageEvidence{
		DriveCount: detail.DriveCount,
		DistanceM:  detail.DistanceM,
		DurationS:  detail.DurationS,
		EnergyWh:   detail.EnergyUsedWh,
		StartedAt:  detail.StartedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if detail.EndedAt != nil {
		ev.EndedAt = detail.EndedAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	if detail.Name != nil {
		ev.CurrentName = *detail.Name
	}
	if n := len(detail.Drives); n > 0 {
		if first := detail.Drives[0]; first.StartPlace != nil {
			ev.StartPlace = first.StartPlace
		}
		if last := detail.Drives[n-1]; last.EndPlace != nil {
			ev.EndPlace = last.EndPlace
		}
	}
	return ev
}

// buildShareCardImageSuggestion synthesises a deterministic seed
// title + image prompt from the evidence + style hint. Used by
// draft_image_prompt to give the LLM a concrete starting point and
// to provide a usable proposal in the no-tool-output failure mode.
func buildShareCardImageSuggestion(trip *tripdb.TripDetail, styleHint string) *shareCardImageSuggestion {
	style := strings.TrimSpace(styleHint)
	if style == "" {
		style = "illustrated postcard"
	}
	title := "TeslaSync Trip Share Card"
	if trip.Name != nil && strings.TrimSpace(*trip.Name) != "" {
		title = strings.TrimSpace(*trip.Name)
	}
	if runes := []rune(title); len(runes) > shareCardMaxTitleLen {
		title = string(runes[:shareCardMaxTitleLen])
	}
	imagePrompt := fmt.Sprintf(
		"A %s illustration of an electric vehicle road trip, capturing the journey atmosphere with warm light, distant horizons, and a hand-illustrated feel suitable for a sharable trip postcard.",
		style,
	)
	if runes := []rune(imagePrompt); len(runes) > shareCardMaxImagePromptLen {
		imagePrompt = string(runes[:shareCardMaxImagePromptLen])
	}
	return &shareCardImageSuggestion{
		TripID:        trip.ID,
		VehicleID:     trip.VehicleID,
		ProposedTitle: title,
		ImagePrompt:   imagePrompt,
		StyleHint:     style,
	}
}

// draftImagePrompt is the propose-only tool that builds the
// share-card image-prompt seed envelope. It is the FIRST tool the
// LLM is expected to call (per the strategy's system prompt). The
// returned Evidence + Suggested fields ground the LLM's subsequent
// title + image prompt in real trip data.
//
// Execution is pure: input → typed envelope. No DB write; no SQL;
// no side effects beyond the read of TripDetail used to populate
// the evidence + seed.
type draftImagePrompt struct {
	details TripDetailSource
}

func (t *draftImagePrompt) Name() string { return "draft_image_prompt" }

func (t *draftImagePrompt) Description() string {
	return "Build a share-card image-prompt seed envelope for the given trip. " +
		"PROPOSE-ONLY: nothing is generated, uploaded, or saved. Returns " +
		"{suggested: {trip_id, vehicle_id, proposed_title, image_prompt, style_hint}, " +
		"evidence: {start_place, end_place, drive_count, distance_m, duration_s, energy_wh, started_at, ended_at, current_name}, " +
		"status: ok|invalid}. " +
		"Call FIRST, then call render_share_card_preview with a refined proposed_title + image_prompt."
}

func (t *draftImagePrompt) InputSchema() json.RawMessage {
	return tools.CachedSchema(shareCardImageDraftInput{})
}

// OutputSchema implements [Tool].
func (t *draftImagePrompt) OutputSchema() json.RawMessage { return nil }

// Propose-only: never mutates state.
func (t *draftImagePrompt) Mutates() bool { return false }

// RequiredScope implements [Tool].
func (t *draftImagePrompt) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftImagePrompt) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[shareCardImageDraftInput](raw)
}

// Execute implements [Tool]. Reads the trip detail to build the
// evidence envelope + the deterministic suggestion seed.
func (t *draftImagePrompt) Execute(ctx context.Context, in any) (any, error) {
	input := in.(shareCardImageDraftInput)
	if t.details == nil {
		return nil, errors.New("draft_image_prompt: no TripDetailSource wired")
	}

	detail, err := t.details.GetTrip(ctx, input.TripID)
	if err != nil {
		return nil, err
	}
	if detail == nil {
		return nil, errors.New("draft_image_prompt: trip not found")
	}

	out := &shareCardImageDraftOutput{
		Suggested: buildShareCardImageSuggestion(detail, input.StyleHint),
		Evidence:  buildShareCardImageEvidence(detail),
		Status:    "ok",
		Source:    "validator: internal/ai/tools/share_card_image.go shareCardImageValidator",
	}
	return out, nil
}

// renderShareCardPreview is the propose-only tool that validates a
// share-card preview proposal (title + image prompt + optional
// subtitle / style / palette hints) and returns a render-ready
// envelope. It is the SECOND tool the LLM is expected to call (per
// the strategy's system prompt) — immediately after
// draft_image_prompt, so the assistant can confirm the proposal
// would render before narrating it to the user.
//
// PROPOSE-ONLY: nothing is generated, uploaded, or saved. The
// validator refuses obvious lat/long / street-address leakage
// in the proposed title or image prompt as defence-in-depth even
// though the redaction policy already strips them upstream.
type renderShareCardPreview struct {
	details TripDetailSource
}

func (t *renderShareCardPreview) Name() string { return "render_share_card_preview" }

func (t *renderShareCardPreview) Description() string {
	return "Validate a share-card preview proposal (proposed_title + image_prompt + optional subtitle/style/palette) and return a render-ready envelope. " +
		"PROPOSE-ONLY: nothing is generated, uploaded, or saved. " +
		"Returns {preview: {trip_id, vehicle_id, proposed_title, subtitle, image_prompt, style_hint, palette_hint}, " +
		"evidence: {...}, status: ok|invalid, validation_error}. " +
		"Use AFTER draft_image_prompt to confirm the proposal will render before narrating it to the user."
}

func (t *renderShareCardPreview) InputSchema() json.RawMessage {
	return tools.CachedSchema(shareCardImagePreviewInput{})
}

// OutputSchema implements [Tool].
func (t *renderShareCardPreview) OutputSchema() json.RawMessage { return nil }

// Propose-only: never mutates state.
func (t *renderShareCardPreview) Mutates() bool { return false }

// RequiredScope implements [Tool].
func (t *renderShareCardPreview) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *renderShareCardPreview) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[shareCardImagePreviewInput](raw)
}

// Execute implements [Tool]. Validation failures surface as
// Status="invalid", never as a returned error. A missing trip is
// returned as an error so the LLM can retry.
func (t *renderShareCardPreview) Execute(ctx context.Context, in any) (any, error) {
	input := in.(shareCardImagePreviewInput)
	if t.details == nil {
		return nil, errors.New("render_share_card_preview: no TripDetailSource wired")
	}

	detail, err := t.details.GetTrip(ctx, input.TripID)
	if err != nil {
		return nil, err
	}
	if detail == nil {
		return nil, errors.New("render_share_card_preview: trip not found")
	}

	evidence := buildShareCardImageEvidence(detail)
	out := &shareCardImagePreviewOutput{
		Evidence: evidence,
		Status:   "ok",
		Source:   "validator: internal/ai/tools/share_card_image.go shareCardImageValidator",
	}

	// Per-field validation. The first failure wins so the LLM
	// gets one actionable diagnostic per round-trip.
	if err := validateShareCardImageString("title", input.ProposedTitle, shareCardMaxTitleLen); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
		return out, nil
	}
	if err := validateShareCardImageString("image_prompt", input.ImagePrompt, shareCardMaxImagePromptLen); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
		return out, nil
	}
	if input.Subtitle != "" {
		if err := validateShareCardImageString("subtitle", input.Subtitle, shareCardMaxSubtitleLen); err != nil {
			out.Status = "invalid"
			out.ValidationError = err.Error()
			return out, nil
		}
	}
	if input.StyleHint != "" {
		if err := validateShareCardImageString("style_hint", input.StyleHint, shareCardMaxStyleHintLen); err != nil {
			out.Status = "invalid"
			out.ValidationError = err.Error()
			return out, nil
		}
	}
	if input.PaletteHint != "" {
		if err := validateShareCardImageString("palette_hint", input.PaletteHint, shareCardMaxPaletteHintLen); err != nil {
			out.Status = "invalid"
			out.ValidationError = err.Error()
			return out, nil
		}
	}

	out.Preview = &shareCardImagePreview{
		TripID:        detail.ID,
		VehicleID:     detail.VehicleID,
		ProposedTitle: input.ProposedTitle,
		Subtitle:      input.Subtitle,
		ImagePrompt:   input.ImagePrompt,
		StyleHint:     input.StyleHint,
		PaletteHint:   input.PaletteHint,
	}
	return out, nil
}

// TripPostcardShareCardImageGenerationSources bundles the narrow
// read interfaces RegisterTripPostcardShareCardImageGenerationTools
// needs. Mirrors [AutoTripNamingSources].
//
// Production wiring (router.go) instantiates the production adapter
// (*tripdb.TripsDetailRepo); tests substitute deterministic fakes.
type TripPostcardShareCardImageGenerationSources struct {
	Details TripDetailSource
}

// RegisterTripPostcardShareCardImageGenerationTools installs the
// trip-postcard-share-card-image-generation tools on r. Called after
// earlier tool registrations so the registry's alphabetical Names
// list grows deterministically.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterTripPostcardShareCardImageGenerationTools(r *tools.Registry, s TripPostcardShareCardImageGenerationSources) {
	r.Register(&draftImagePrompt{details: s.Details})
	r.Register(&renderShareCardPreview{details: s.Details})
}
