// Phase-50 / 0038 — G2 Suggest new geofences.
//
// suggest_new_geofences.go ships TWO new propose-only tools:
//
//   - `draft_geofence`    — accept a location_id + an LLM-proposed name
//                           + radius_m and return a normalized + validated
//                           geofence draft envelope the GeofencesPage UI
//                           can render for human review. The envelope
//                           also carries the location's actual visit
//                           evidence (current address_name, visit_count,
//                           total_duration_s, last_visited) and a
//                           computed centroid (lat/lon) so the LLM's
//                           follow-up rationale stays grounded and the
//                           SPA can pre-fill the existing Add Geofence
//                           form. The actual centroid is sourced from
//                           the visited-location aggregate; the LLM
//                           never invents coordinates.
//   - `validate_geofence` — accept a location_id + a proposed name +
//                           radius_m and report whether the envelope
//                           satisfies the geofence-shape contract
//                           (non-empty trimmed name, 1-200 chars; no
//                           control chars; radius 50-1000 meters).
//                           Mirrors auto-name-unnamed-locations'
//                           draft+validate pair.
//
// Both tools are PROPOSE-ONLY: they construct or validate geofence
// DTOs but do NOT touch the database. The dispatcher's deny-all
// confirm gate is therefore never triggered — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// geofence persistence flows through an explicit user confirmation
// in the GeofencesPage UI: the user reviews the draft, clicks "Apply
// to form" which copies the proposed name + centroid + radius into
// the existing baseline Add Geofence modal, then SAVES IT THEMSELVES
// via the canonical baseline POST /api/v1/geofences (out of scope
// for this slice's write surface; the slice prompt mandates "without
// creating them autonomously"); the LLM has no tool that writes.
//
// "Unfenced" interpretation: the strategy targets visited-location
// aggregates that have no overlapping geofence in the database. The
// strategy's prompt nudges the LLM toward locations whose visit
// frequency justifies a geofence (e.g. visit_count >= 3); the
// validator does not enforce this because a user MAY legitimately
// request a geofence around a less-visited spot too (e.g. a
// scheduled appointment location).
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate validation
//     to GeofenceValidator (production-wired to
//     *api.AISuggestGeofenceValidator, which mirrors the same
//     trimming + length + control-character + radius rules the
//     canonical POST /api/v1/geofences handler enforces). A draft
//     accepted here is byte-equivalent to a draft the canonical save
//     handler would accept.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     evidence envelope is built from the same narrow LocationSource
//     interface auto-name-unnamed-locations already exposes
//     (production: *api.AILocationSource which composes a
//     drives-table read for the by-ID lookup) — the same read
//     surface the GET /api/v1/locations baseline handler uses.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; the evidence is a pure read of
//     existing aggregates.
//
//   - Privacy: the LLM is shown the address_name string as a
//     redaction-tagged value (the PolicySuggestNewGeofences
//     allow-list intentionally excludes ClassStreetAddr +
//     ClassLatLong); the round-trip tags are restored only in the
//     final SSE frame returned to the same authenticated user.
//     The centroid lat/lon flows through the typed F4 envelope in
//     the tool reply (not through prompt prose) to the SPA, where
//     the user confirms the values inside the existing Add
//     Geofence form before clicking Save.

package location

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// GeofenceValidator is the narrow validation interface the
// suggest-new-geofences tools need. In production it is satisfied by
// *api.AISuggestGeofenceValidator (a thin wrapper around the same
// trimming + length + radius rules the canonical POST
// /api/v1/geofences handler enforces); tests substitute deterministic
// fakes.
//
// The interface MUST stay validation-only — adding a Save or Update
// method here would defeat the propose-only contract that ADR-015 §I3
// + the slice prompt mandate.
type GeofenceValidator interface {
	// ValidateGeofence reports whether the proposed name + radius
	// would be accepted by the canonical save path for loc.
	// Returns nil on acceptance; an error whose Error() text is
	// suitable for surfacing to the LLM on rejection.
	ValidateGeofence(loc *geomodel.VisitedLocation, proposedName string, radiusM float64) error
}

// suggestNewGeofencesMaxNameLen is the hard cap on the proposed
// name's rune-length. Mirrors the location-name 200-char cap (and
// the alert-rule 200-char cap) so every per-feature label surface
// stays within one render line in the UI.
const suggestNewGeofencesMaxNameLen = 200

// suggestNewGeofencesMinRadiusM / suggestNewGeofencesMaxRadiusM bound
// the proposed circle radius. The lower bound rejects accidental
// zero-radius envelopes; the upper bound is generous enough to
// cover a parking lot or a small block but tight enough to prevent
// "geofence the entire metro area" mistakes. Both bounds are
// pinned by tests on both sides (tool + production validator
// wrapper).
const (
	suggestNewGeofencesMinRadiusM = 50.0
	suggestNewGeofencesMaxRadiusM = 1000.0
)

// geofenceDraftInput is the typed input shape both tools share. The
// dispatcher decodes the LLM's tool-call arguments JSON into this
// struct via ValidateStruct so a malformed input fails before any
// validator method runs.
type geofenceDraftInput struct {
	// LocationID is the visited-location the proposed geofence
	// applies to. Required and positive. The AI handler always
	// scopes to the caller-supplied location via the request
	// body; the LLM MAY propose a different ID via the input,
	// but the handler clamps the scope before invoking the tool.
	LocationID int64 `json:"location_id" validate:"required,gte=1" desc:"Numeric visited-location ID this geofence applies to."`

	// ProposedName is the human-readable geofence name the LLM
	// proposes. Capped at 200 chars to mirror the geofence-name
	// contract; at least 1 char so a blank name surfaces as an
	// LLM-side error before reaching the validator.
	ProposedName string `json:"proposed_name" validate:"required,gte=1,lte=200" desc:"Proposed human-readable geofence name (1-200 chars)."`

	// RadiusM is the proposed geofence radius in meters. Bounded
	// 50-1000 so a zero-radius mistake or a city-wide envelope is
	// rejected at the dispatcher boundary.
	RadiusM float64 `json:"radius_m" validate:"required,gte=50,lte=1000" desc:"Proposed circle radius in meters (50-1000)."`
}

// geofenceEvidence is the read-only context envelope the
// draft_geofence tool returns alongside the validated draft. The LLM
// is expected to ground its follow-up rationale in these fields.
// Numeric units are SI-canonical (meters for radius, seconds for
// duration) per Phase-48 — the frontend converts to user-preferred
// display units at the render boundary.
type geofenceEvidence struct {
	// CurrentAddressName is the geocoder's last-known label for
	// this location. May be empty / "Unknown" / coord-shaped for
	// the unfenced locations this slice targets; the LLM uses the
	// presence/absence of this string to decide whether to
	// reference the existing label or propose a generic descriptor
	// like "Frequent Stop".
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

// geofenceDraftOutput is the JSON envelope draft_geofence returns.
// The frontend renders Draft as the structured proposal in the
// GeofencesPage's AI side panel. The user reviews the proposal and
// clicks "Apply to form" which copies the name + radius into the
// existing baseline Add Geofence modal — the AI panel never writes
// to /api/v1/geofences itself.
type geofenceDraftOutput struct {
	// Draft is the proposed geofence shape with LocationID
	// clamped to the caller's actual scope. Carries the
	// computed centroid from the visited-location aggregate so
	// the SPA can pre-fill the existing Add Geofence form
	// without the LLM having to invent coordinates.
	Draft *geofenceDraft `json:"draft"`

	// Status is "ok" or "invalid". The frontend disables the
	// "Apply to form" button when status != "ok". Mirrors the
	// status vocabulary used by auto-name-unnamed-locations'
	// draft_location_name tool so the dispatcher's tool-result
	// rendering stays uniform.
	Status string `json:"status"`

	// ValidationError is the canonical validator's diagnostic on
	// rejection, empty otherwise.
	ValidationError string `json:"validation_error,omitempty"`

	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the canonical
	// validator rather than its own reasoning.
	Source string `json:"source"`
}

// geofenceDraft is the proposal envelope rendered to the user. The
// `proposed_name` + `radius_m` fields are what the user reviews +
// (optionally edits) before saving via the existing baseline Add
// Geofence form. The `centroid_lat` + `centroid_lon` fields are the
// ground-truth coordinates the SPA pre-fills the form with — the
// LLM never invents them; the tool computes them from the
// visited-location aggregate.
type geofenceDraft struct {
	LocationID   int64            `json:"location_id"`
	VehicleID    int64            `json:"vehicle_id"`
	ProposedName string           `json:"proposed_name"`
	RadiusM      float64          `json:"radius_m"`
	CentroidLat  float64          `json:"centroid_lat"`
	CentroidLon  float64          `json:"centroid_lon"`
	Evidence     geofenceEvidence `json:"evidence"`
}

// validateGeofenceShape runs the deterministic geofence-shape
// validation the production validator wrapper also enforces.
// Extracted so the tool's "would this be accepted" check is
// byte-equivalent to the production wrapper without the tool needing
// to round-trip through the wrapper for every call. The production
// wrapper calls this function directly.
//
// Rules (pinned by tests):
//
//   - rune-trimmed name must be 1-200 chars;
//   - no control characters (Unicode category Cc) anywhere;
//   - leading / trailing whitespace is rejected (the user can fix
//     this by clicking the proposal into the input and saving the
//     trimmed version; we don't auto-trim because the user may have
//     intentionally added a leading emoji + space);
//   - radius_m must be 50-1000 (inclusive); NaN / Inf rejected.
func validateGeofenceShape(proposedName string, radiusM float64) error {
	if proposedName == "" {
		return errors.New("geofence name must not be empty")
	}
	if strings.TrimSpace(proposedName) == "" {
		return errors.New("geofence name must contain at least one non-whitespace character")
	}
	if proposedName[0] == ' ' || proposedName[0] == '\t' ||
		proposedName[len(proposedName)-1] == ' ' || proposedName[len(proposedName)-1] == '\t' {
		return errors.New("geofence name must not have leading or trailing whitespace")
	}
	runes := []rune(proposedName)
	if len(runes) > suggestNewGeofencesMaxNameLen {
		return errors.New("geofence name must be at most 200 characters")
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return errors.New("geofence name must not contain control characters")
		}
	}
	if math.IsNaN(radiusM) || math.IsInf(radiusM, 0) {
		return errors.New("geofence radius must be a finite number of meters")
	}
	if radiusM < suggestNewGeofencesMinRadiusM {
		return errors.New("geofence radius must be at least 50 meters")
	}
	if radiusM > suggestNewGeofencesMaxRadiusM {
		return errors.New("geofence radius must be at most 1000 meters")
	}
	return nil
}

// buildGeofenceEvidence converts a *geomodel.VisitedLocation into the
// read-only evidence envelope returned by both tools. Format choice:
// ISO-8601 UTC strings so the LLM's follow-up prose can quote the
// dates back to the user without ambiguity.
func buildGeofenceEvidence(loc *geomodel.VisitedLocation) geofenceEvidence {
	ev := geofenceEvidence{
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

// parseCentroidFromAddress extracts a (lat, lon) centroid from a
// visited-location aggregate. Visited-location address_name strings
// either carry a coordinate-shaped fallback ("47.6062, -122.3321"
// when the geocoder failed) or a human-readable label. When the
// label is coordinate-shaped, this function parses the pair so the
// tool's draft envelope can carry a real centroid into the SPA's
// pre-fill flow. When the label is not coordinate-shaped, the
// centroid is reported as (0, 0) and the SPA will fall back to its
// usual "use current location" affordance — the AI panel still
// renders the proposed name + radius for the user to apply, which
// is the dominant case.
//
// We intentionally do NOT plumb the drives table's per-row lat/lon
// here — the visited-location aggregate carries the geocoder's
// label, which is the SAME value the existing GeofencesPage already
// surfaces in the Add Geofence form's lat/lon inputs when the user
// picks a location from the aggregate. Threading the drives
// per-vehicle lat/lon would be a separate (out-of-scope) read path.
//
// The accepted formats are:
//
//   - "lat, lon"        (e.g. "47.6062, -122.3321")
//   - "lat,lon"         (no space)
//   - "lat lon"         (single space, no comma)
//
// Anything else returns (0, 0, false) and the caller treats it as
// "no usable centroid".
func parseCentroidFromAddress(addressName string) (lat, lon float64, ok bool) {
	s := strings.TrimSpace(addressName)
	if s == "" {
		return 0, 0, false
	}
	// Normalise "lat,lon" variants into a single-comma form,
	// then split.
	var parts []string
	switch {
	case strings.Contains(s, ","):
		parts = strings.SplitN(s, ",", 2)
	default:
		parts = strings.Fields(s)
	}
	if len(parts) != 2 {
		return 0, 0, false
	}
	latStr := strings.TrimSpace(parts[0])
	lonStr := strings.TrimSpace(parts[1])
	if latStr == "" || lonStr == "" {
		return 0, 0, false
	}
	latVal, err1 := parseFloat64(latStr)
	lonVal, err2 := parseFloat64(lonStr)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	if latVal < -90 || latVal > 90 || lonVal < -180 || lonVal > 180 {
		return 0, 0, false
	}
	return latVal, lonVal, true
}

// parseFloat64 is a small wrapper that delegates to strconv.ParseFloat.
// Kept as a named helper so the call site in parseCentroidFromAddress
// reads as "parse a float64 from a centroid component" rather than as
// a strconv mechanic.
func parseFloat64(s string) (float64, error) {
	return strconv.ParseFloat(s, 64)
}

// draftGeofence is the propose-only tool that builds a normalized +
// validated geofence draft for the GeofencesPage UI to render. It
// is the FIRST tool the LLM is expected to call (per the strategy's
// system prompt).
//
// Execution is pure: input → typed draft → canonical validator pass
// → JSON envelope. No DB write; no SQL; no side effects beyond the
// read of the visited-location aggregate used to populate the
// evidence envelope and the centroid.
type draftGeofence struct {
	locations LocationSource
	validator GeofenceValidator
}

// Name implements [Tool].
func (t *draftGeofence) Name() string { return "draft_geofence" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *draftGeofence) Description() string {
	return "Build a typed geofence draft (centroid lat/lon + radius_m + name) from the caller's proposed name and the visited-location's actual evidence " +
		"(current address_name, visit_count, total_duration_s, last_visited_at). " +
		"PROPOSE-ONLY: the geofence is NOT created; the user reviews the draft in the UI and clicks Save in the existing baseline Add Geofence form. " +
		"Returns {draft: {location_id, vehicle_id, proposed_name, radius_m, centroid_lat, centroid_lon, evidence{...}}, status: ok|rejected, reason}."
}

// InputSchema implements [Tool].
func (t *draftGeofence) InputSchema() json.RawMessage {
	return tools.CachedSchema(geofenceDraftInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftGeofence) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftGeofence) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream.
func (t *draftGeofence) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftGeofence) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[geofenceDraftInput](raw)
}

// Execute implements [Tool]. Reads the visited-location aggregate to
// build the evidence envelope + centroid, then runs the validator
// over the proposed name + radius. Validation failures surface as
// status="rejected" in the envelope; a missing location surfaces as
// a returned error (the LLM retries with a different location_id).
func (t *draftGeofence) Execute(ctx context.Context, in any) (any, error) {
	input := in.(geofenceDraftInput)
	if t.locations == nil {
		return nil, errors.New("draft_geofence: no LocationSource wired")
	}
	if t.validator == nil {
		return nil, errors.New("draft_geofence: no GeofenceValidator wired")
	}

	loc, err := t.locations.LoadVisitedLocation(ctx, input.LocationID)
	if err != nil {
		return nil, err
	}
	if loc == nil {
		return nil, errors.New("draft_geofence: visited-location not found")
	}

	lat, lon, _ := parseCentroidFromAddress(loc.AddressName)
	draft := &geofenceDraft{
		LocationID:   loc.ID,
		VehicleID:    loc.VehicleID,
		ProposedName: input.ProposedName,
		RadiusM:      input.RadiusM,
		CentroidLat:  lat,
		CentroidLon:  lon,
		Evidence:     buildGeofenceEvidence(loc),
	}

	out := &geofenceDraftOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/api/ai_suggest_new_geofences_handler.go AISuggestGeofenceValidator",
	}
	if err := t.validator.ValidateGeofence(loc, input.ProposedName, input.RadiusM); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// geofenceValidateInput is the typed input for validate_geofence.
// Mirrors geofenceDraftInput field-for-field; kept separate so a
// future divergence (e.g. additional flags for diff-style validation)
// does not force a shared shape to grow.
type geofenceValidateInput struct {
	LocationID   int64   `json:"location_id" validate:"required,gte=1" desc:"Numeric visited-location ID this geofence applies to."`
	ProposedName string  `json:"proposed_name" validate:"required,gte=1,lte=200" desc:"Proposed human-readable geofence name (1-200 chars)."`
	RadiusM      float64 `json:"radius_m" validate:"required,gte=50,lte=1000" desc:"Proposed circle radius in meters (50-1000)."`
}

// geofenceValidateOutput is the envelope validate_geofence returns.
// Mirrors geofenceDraftOutput minus the Draft field — the LLM
// already has the draft from the earlier draft_geofence call.
type geofenceValidateOutput struct {
	Status          string `json:"status"`
	ValidationError string `json:"validation_error,omitempty"`
	Source          string `json:"source"`
}

// validateGeofenceTool is the propose-only tool that runs the
// canonical geofence validator over a typed shape and reports the
// verdict. It is the SECOND tool the LLM is expected to call (per
// the strategy's system prompt) — typically immediately after
// draft_geofence, so the assistant can confirm the draft would pass
// before narrating it to the user.
type validateGeofenceTool struct {
	locations LocationSource
	validator GeofenceValidator
}

// Name implements [Tool].
func (t *validateGeofenceTool) Name() string { return "validate_geofence" }

// Description implements [Tool].
func (t *validateGeofenceTool) Description() string {
	return "Run the canonical geofence validator over a proposed name + radius_m and report whether the envelope would be accepted by the geofence-save path. " +
		"PROPOSE-ONLY: nothing is saved. Returns {status: ok|rejected, reason}. " +
		"Use this AFTER draft_geofence to confirm a proposed envelope will be accepted before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateGeofenceTool) InputSchema() json.RawMessage {
	return tools.CachedSchema(geofenceValidateInput{})
}

// OutputSchema implements [Tool].
func (t *validateGeofenceTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateGeofenceTool) Mutates() bool { return false }

// RequiredScope implements [Tool].
func (t *validateGeofenceTool) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *validateGeofenceTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[geofenceValidateInput](raw)
}

// Execute implements [Tool]. Same error semantics as draft_geofence:
// validation failures are surfaced as status="rejected", never as a
// returned error. A missing location is returned as an error so the
// LLM can retry with a different ID.
func (t *validateGeofenceTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(geofenceValidateInput)
	if t.locations == nil {
		return nil, errors.New("validate_geofence: no LocationSource wired")
	}
	if t.validator == nil {
		return nil, errors.New("validate_geofence: no GeofenceValidator wired")
	}

	loc, err := t.locations.LoadVisitedLocation(ctx, input.LocationID)
	if err != nil {
		return nil, err
	}
	if loc == nil {
		return nil, errors.New("validate_geofence: visited-location not found")
	}

	out := &geofenceValidateOutput{
		Status: "ok",
		Source: "validator: internal/api/ai_suggest_new_geofences_handler.go AISuggestGeofenceValidator",
	}
	if err := t.validator.ValidateGeofence(loc, input.ProposedName, input.RadiusM); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// SuggestNewGeofencesSources bundles the narrow read + validator
// interfaces RegisterSuggestNewGeofencesTools needs. Mirrors
// [AutoNameUnnamedLocationsSources] / [AutoTripNamingSources].
//
// Production wiring (router.go) instantiates the two production
// adapters (*api.AILocationSource — already exists from slice 0037 —
// + *api.AISuggestGeofenceValidator); tests substitute deterministic
// fakes.
type SuggestNewGeofencesSources struct {
	Locations LocationSource
	Validator GeofenceValidator
}

// RegisterSuggestNewGeofencesTools installs the suggest-new-geofences
// slice's tools on r. Called from router.go AFTER the previous
// slice's tool registrations so the registry's alphabetical Names
// list grows deterministically without disturbing earlier
// registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterSuggestNewGeofencesTools(r *tools.Registry, s SuggestNewGeofencesSources) {
	r.Register(&draftGeofence{locations: s.Locations, validator: s.Validator})
	r.Register(&validateGeofenceTool{locations: s.Locations, validator: s.Validator})
}
