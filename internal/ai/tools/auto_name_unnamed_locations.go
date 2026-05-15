// Phase-50 / 0037 — G1 Auto-name unnamed locations.
//
// auto_name_unnamed_locations.go ships TWO new propose-only tools:
//
//   - `draft_location_name`    — accept a location_id + an LLM-proposed
//                                name and return a normalized + validated
//                                draft envelope the LocationsPage UI can
//                                render for human review. The envelope
//                                also carries the location's actual visit
//                                evidence (current address_name,
//                                visit_count, total_duration_s,
//                                last_visited) so the LLM's follow-up
//                                rationale stays grounded.
//   - `validate_location_name` — accept a location_id + a proposed name
//                                and report whether it satisfies the
//                                location-name contract (non-empty,
//                                trimmed, 1-200 chars, no control chars).
//                                Mirrors the auto-trip-naming pair.
//
// Both tools are PROPOSE-ONLY: they construct or validate location-name
// DTOs but do NOT touch the database. The dispatcher's deny-all
// confirm gate is therefore never triggered — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// location-name persistence flows through an explicit user
// confirmation in the LocationsPage UI (the user reviews the draft
// then SAVES IT THEMSELVES via the canonical baseline geofence /
// notes form — out of scope for this slice's write surface; the
// slice prompt mandates "explicit user confirmation"); the LLM has
// no tool that writes.
//
// "Unnamed" interpretation: a *models.VisitedLocation row is treated as
// unnamed when its AddressName is empty, equals the literal "Unknown",
// or matches a coordinate-shaped string (the geocoder's fallback when
// reverse-geocoding fails). The strategy's prompt explains this to
// the LLM; the validator does not enforce it because a user MAY
// legitimately re-name an already-named location too (e.g. "Work" →
// "Work — old building").
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate validation
//     to LocationNameValidator (production-wired to
//     *api.AILocationNameValidator, which mirrors the same trimming +
//     length + control-character rules a future canonical save
//     handler will enforce). A draft accepted here is byte-equivalent
//     to a draft a future canonical save handler would accept.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     evidence envelope is built from a narrow LocationSource
//     interface (production: *api.AILocationSource which composes
//     *database.VisitedLocationRepo + a small drives-table read for
//     the by-ID lookup) — the same read surface the GET
//     /api/v1/locations baseline handler already exposes.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; the evidence is a pure read of
//     existing aggregates.
//
//   - Privacy: the LLM is shown the address_name string as a
//     redaction-tagged value (the PolicyAutoNameUnnamedLocations
//     allow-list intentionally excludes ClassStreetAddr +
//     ClassLatLong); the round-trip tags are restored only in the
//     final SSE frame returned to the same authenticated user.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// LocationSource is the narrow visited-location read interface the
// auto-name-unnamed-locations tools need. In production it is
// satisfied by *api.AILocationSource which composes
// *database.VisitedLocationRepo with a by-ID drive lookup; tests
// substitute deterministic fakes.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the propose-only contract that ADR-015 §I3 +
// the slice prompt mandate.
type LocationSource interface {
	// LoadVisitedLocation returns the visited-location aggregate
	// for locationID, or (nil, error) if it does not exist or is
	// not visible to the caller. The locationID is the synthetic
	// MIN(d.id) per (vehicle_id, end_place) the
	// VisitedLocationRepo emits — the same ID the SPA's
	// LocationsPage list rows carry.
	//
	// The error text is suitable for surfacing to the LLM (it is
	// relayed back as a tool error reply).
	LoadVisitedLocation(ctx context.Context, locationID int64) (*models.VisitedLocation, error)
}

// LocationNameValidator is the narrow validation interface the
// auto-name-unnamed-locations tools need. In production it is
// satisfied by *api.AILocationNameValidator (a thin wrapper around
// the same trimming + length rules a future canonical save handler
// will enforce); tests substitute deterministic fakes.
//
// The interface MUST stay validation-only — adding a Save or Update
// method here would defeat the propose-only contract that ADR-015
// §I3 + the slice prompt mandate.
type LocationNameValidator interface {
	// ValidateLocationName reports whether proposed would be
	// accepted by the canonical save path for loc. Returns nil
	// on acceptance; an error whose Error() text is suitable for
	// surfacing to the LLM on rejection.
	ValidateLocationName(loc *models.VisitedLocation, proposed string) error
}

// autoNameUnnamedLocationsMaxNameLen is the hard cap on the proposed
// name's rune-length. Mirrors the trip-name 200-char cap (and the
// alert-rule 200-char cap) so every per-feature label surface stays
// within one render line in the UI.
const autoNameUnnamedLocationsMaxNameLen = 200

// locationNameDraftInput is the typed input shape both tools share.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails before
// any validator method runs.
type locationNameDraftInput struct {
	// LocationID is the visited-location the proposed name applies
	// to. Required and positive. The AI handler always scopes to
	// the caller-supplied location via the URL path param; the
	// LLM MAY propose a different ID via the input, but the
	// handler clamps the scope before invoking the tool.
	LocationID int64 `json:"location_id" validate:"required,gte=1" desc:"Numeric visited-location ID this name applies to."`

	// ProposedName is the human-readable name the LLM proposes.
	// Capped at 200 chars to mirror the trip-name contract; at
	// least 1 char so a blank name surfaces as an LLM-side error
	// before reaching the validator.
	ProposedName string `json:"proposed_name" validate:"required,gte=1,lte=200" desc:"Proposed human-readable location name (1-200 chars)."`
}

// locationNameEvidence is the read-only context envelope the
// draft_location_name tool returns alongside the validated draft.
// The LLM is expected to ground its follow-up rationale in these
// fields. Numeric units are SI-canonical (seconds for duration) per
// Phase-48 — the frontend converts to user-preferred display units
// at the render boundary.
type locationNameEvidence struct {
	// CurrentAddressName is the geocoder's last-known label for
	// this location. May be empty / "Unknown" / coord-shaped for
	// the unnamed locations this slice targets; the LLM uses the
	// presence/absence of this string to decide how aggressively
	// to propose a renaming versus simply confirming the current
	// label.
	CurrentAddressName string `json:"current_address_name,omitempty"`

	// VisitCount is how many drives ended at this location. The
	// LLM may use this to infer significance ("frequent stop"
	// vs "one-off") — but never to invent new facts.
	VisitCount int `json:"visit_count"`

	// TotalDurationS is the SI-canonical sum of dwell time at
	// this location across all visits.
	TotalDurationS float64 `json:"total_duration_s"`

	// LastVisitedAt is the ISO-8601 UTC timestamp of the most
	// recent visit, or empty if the aggregate has never been
	// observed.
	LastVisitedAt string `json:"last_visited_at,omitempty"`

	// FirstVisitedAt is the ISO-8601 UTC timestamp of the
	// earliest observed visit (the synthesised CreatedAt the
	// repo emits).
	FirstVisitedAt string `json:"first_visited_at,omitempty"`
}

// locationNameDraftOutput is the JSON envelope draft_location_name
// returns. The frontend renders Draft as the structured proposal in
// the LocationsPage's AI side panel.
type locationNameDraftOutput struct {
	// Draft is the proposed location-name shape with LocationID
	// clamped to the caller's actual scope.
	Draft *locationNameDraft `json:"draft"`

	// Status is "ok" or "invalid".
	Status string `json:"status"`

	// ValidationError is the canonical validator's diagnostic on
	// rejection, empty otherwise.
	ValidationError string `json:"validation_error,omitempty"`

	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the canonical
	// validator rather than its own reasoning.
	Source string `json:"source"`
}

// locationNameDraft is the proposal envelope rendered to the user.
// The `proposed_name` field is what the user reviews + (optionally
// edits) before saving via the explicit confirmation flow in the
// LocationsPage UI.
type locationNameDraft struct {
	LocationID   int64                `json:"location_id"`
	VehicleID    int64                `json:"vehicle_id"`
	ProposedName string               `json:"proposed_name"`
	Evidence     locationNameEvidence `json:"evidence"`
}

// validateLocationNameShape runs the deterministic location-name
// validation the production validator wrapper also enforces.
// Extracted so the tool's "would this be accepted" check is
// byte-equivalent to the production wrapper without the tool
// needing to round-trip through the wrapper for every call. The
// production wrapper calls this function directly.
//
// Rules (pinned by tests):
//
//   - rune-trimmed name must be 1-200 chars;
//   - no control characters (Unicode category Cc) anywhere;
//   - leading / trailing whitespace is rejected (the user can fix
//     this by clicking the proposal into the input and saving the
//     trimmed version; we don't auto-trim because the user may have
//     intentionally added a leading emoji + space).
func validateLocationNameShape(proposed string) error {
	if proposed == "" {
		return errors.New("location name must not be empty")
	}
	if strings.TrimSpace(proposed) == "" {
		return errors.New("location name must contain at least one non-whitespace character")
	}
	if proposed[0] == ' ' || proposed[0] == '\t' || proposed[len(proposed)-1] == ' ' || proposed[len(proposed)-1] == '\t' {
		return errors.New("location name must not have leading or trailing whitespace")
	}
	runes := []rune(proposed)
	if len(runes) > autoNameUnnamedLocationsMaxNameLen {
		return errors.New("location name must be at most 200 characters")
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return errors.New("location name must not contain control characters")
		}
	}
	return nil
}

// buildLocationNameEvidence converts a *models.VisitedLocation into
// the read-only evidence envelope returned by both tools. Format
// choice: ISO-8601 UTC strings so the LLM's follow-up prose can
// quote the dates back to the user without ambiguity.
func buildLocationNameEvidence(loc *models.VisitedLocation) locationNameEvidence {
	ev := locationNameEvidence{
		CurrentAddressName: loc.AddressName,
		VisitCount:         loc.VisitCount,
		TotalDurationS:     loc.TotalDurationS,
		FirstVisitedAt:     loc.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if loc.LastVisited != nil {
		ev.LastVisitedAt = loc.LastVisited.UTC().Format("2006-01-02T15:04:05Z")
	}
	return ev
}

// draftLocationName is the propose-only tool that builds a
// normalized + validated location-name draft for the LocationsPage
// UI to render. It is the FIRST tool the LLM is expected to call
// (per the strategy's system prompt).
//
// Execution is pure: input → typed draft → canonical validator
// pass → JSON envelope. No DB write; no SQL; no side effects beyond
// the read of the visited-location aggregate used to populate the
// evidence envelope.
type draftLocationName struct {
	locations LocationSource
	validator LocationNameValidator
}

// Name implements [Tool].
func (t *draftLocationName) Name() string { return "draft_location_name" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *draftLocationName) Description() string {
	return "Build a typed location-name draft from the caller's proposed name and the visited-location's actual evidence " +
		"(current address_name, visit_count, total_duration_s, last_visited_at). " +
		"PROPOSE-ONLY: the name is NOT saved; the user reviews the draft in the UI before clicking Save. " +
		"Returns {draft: {location_id, vehicle_id, proposed_name, evidence{...}}, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftLocationName) InputSchema() json.RawMessage {
	return cachedSchema(locationNameDraftInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftLocationName) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftLocationName) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream.
func (t *draftLocationName) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftLocationName) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[locationNameDraftInput](raw)
}

// Execute implements [Tool]. Reads the visited-location aggregate
// to build the evidence envelope, then runs the validator over the
// proposed name. Validation failures surface as status="invalid"
// in the envelope; a missing location surfaces as a returned error
// (the LLM retries with a different location_id).
func (t *draftLocationName) Execute(ctx context.Context, in any) (any, error) {
	input := in.(locationNameDraftInput)
	if t.locations == nil {
		return nil, errors.New("draft_location_name: no LocationSource wired")
	}
	if t.validator == nil {
		return nil, errors.New("draft_location_name: no LocationNameValidator wired")
	}

	loc, err := t.locations.LoadVisitedLocation(ctx, input.LocationID)
	if err != nil {
		return nil, err
	}
	if loc == nil {
		return nil, errors.New("draft_location_name: visited-location not found")
	}

	draft := &locationNameDraft{
		LocationID:   loc.ID,
		VehicleID:    loc.VehicleID,
		ProposedName: input.ProposedName,
		Evidence:     buildLocationNameEvidence(loc),
	}

	out := &locationNameDraftOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/api/ai_auto_name_unnamed_locations_handler.go AILocationNameValidator",
	}
	if err := t.validator.ValidateLocationName(loc, input.ProposedName); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// locationNameValidateInput is the typed input for
// validate_location_name. Mirrors locationNameDraftInput
// field-for-field; kept separate so a future divergence (e.g.
// additional flags for diff-style validation) does not force a
// shared shape to grow.
type locationNameValidateInput struct {
	LocationID   int64  `json:"location_id" validate:"required,gte=1" desc:"Numeric visited-location ID this name applies to."`
	ProposedName string `json:"proposed_name" validate:"required,gte=1,lte=200" desc:"Proposed human-readable location name (1-200 chars)."`
}

// locationNameValidateOutput is the envelope validate_location_name
// returns. Mirrors locationNameDraftOutput minus the Draft field —
// the LLM already has the draft from the earlier
// draft_location_name call.
type locationNameValidateOutput struct {
	Status          string `json:"status"`
	ValidationError string `json:"validation_error,omitempty"`
	Source          string `json:"source"`
}

// validateLocationNameTool is the propose-only tool that runs the
// canonical location-name validator over a typed shape and reports
// the verdict. It is the SECOND tool the LLM is expected to call
// (per the strategy's system prompt) — typically immediately after
// draft_location_name, so the assistant can confirm the draft would
// pass before narrating it to the user.
type validateLocationNameTool struct {
	locations LocationSource
	validator LocationNameValidator
}

// Name implements [Tool].
func (t *validateLocationNameTool) Name() string { return "validate_location_name" }

// Description implements [Tool].
func (t *validateLocationNameTool) Description() string {
	return "Run the canonical location-name validator over a proposed name and report whether it would be accepted by the location-save path. " +
		"PROPOSE-ONLY: nothing is saved. Returns {status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_location_name to confirm a proposed name will be accepted before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateLocationNameTool) InputSchema() json.RawMessage {
	return cachedSchema(locationNameValidateInput{})
}

// OutputSchema implements [Tool].
func (t *validateLocationNameTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateLocationNameTool) Mutates() bool { return false }

// RequiredScope implements [Tool].
func (t *validateLocationNameTool) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *validateLocationNameTool) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[locationNameValidateInput](raw)
}

// Execute implements [Tool]. Same error semantics as
// draft_location_name: validation failures are surfaced as
// status="invalid", never as a returned error. A missing location
// is returned as an error so the LLM can retry with a different ID.
func (t *validateLocationNameTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(locationNameValidateInput)
	if t.locations == nil {
		return nil, errors.New("validate_location_name: no LocationSource wired")
	}
	if t.validator == nil {
		return nil, errors.New("validate_location_name: no LocationNameValidator wired")
	}

	loc, err := t.locations.LoadVisitedLocation(ctx, input.LocationID)
	if err != nil {
		return nil, err
	}
	if loc == nil {
		return nil, errors.New("validate_location_name: visited-location not found")
	}

	out := &locationNameValidateOutput{
		Status: "ok",
		Source: "validator: internal/api/ai_auto_name_unnamed_locations_handler.go AILocationNameValidator",
	}
	if err := t.validator.ValidateLocationName(loc, input.ProposedName); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// AutoNameUnnamedLocationsSources bundles the narrow read +
// validator interfaces RegisterAutoNameUnnamedLocationsTools needs.
// Mirrors [AutoTripNamingSources] / [CrossRuleConflictDetectionSources].
//
// Production wiring (router.go) instantiates the two production
// adapters (*api.AILocationSource + *api.AILocationNameValidator);
// tests substitute deterministic fakes.
type AutoNameUnnamedLocationsSources struct {
	Locations LocationSource
	Validator LocationNameValidator
}

// RegisterAutoNameUnnamedLocationsTools installs the
// auto-name-unnamed-locations slice's tools on r. Called from
// router.go AFTER the previous slice's tool registrations so the
// registry's alphabetical Names list grows deterministically without
// disturbing earlier registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterAutoNameUnnamedLocationsTools(r *Registry, s AutoNameUnnamedLocationsSources) {
	r.Register(&draftLocationName{locations: s.Locations, validator: s.Validator})
	r.Register(&validateLocationNameTool{locations: s.Locations, validator: s.Validator})
}
