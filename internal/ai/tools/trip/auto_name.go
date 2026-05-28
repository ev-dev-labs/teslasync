// Phase-50 / 0024 — D4 Auto trip naming.
//
// auto_trip_naming.go ships TWO new propose-only tools:
//
//   - `draft_trip_name`    — accept a trip_id + an LLM-proposed name
//                            and return a normalized + validated draft
//                            envelope the TripDetailPage UI can render
//                            for human review. The envelope also
//                            carries the trip's actual route context
//                            (start_place, end_place, drive_count,
//                            distance, time window) so the LLM's
//                            follow-up rationale stays grounded.
//   - `validate_trip_name` — accept a trip_id + a proposed name and
//                            report whether it satisfies the
//                            trip-name contract (non-empty, trimmed,
//                            1-200 chars, no control characters).
//                            Mirrors the alert-builder pair.
//
// Both tools are PROPOSE-ONLY: they construct or validate trip-name
// DTOs but do NOT touch the database. The dispatcher's deny-all
// confirm gate is therefore never triggered — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// trip-name persistence flows through an explicit user confirmation
// in the TripDetailPage UI (out of scope for this slice — the slice
// prompt mandates "explicit user confirmation before saving"); the
// LLM has no tool that writes.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate validation
//     to TripNameValidator (production-wired to
//     *api.AITripNameValidator, which mirrors the canonical
//     name-validation rules a future trip-update handler will
//     enforce). A draft accepted here is byte-equivalent to a draft
//     a future canonical save handler would accept.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     evidence envelope is built from a narrow TripDetailSource
//     interface (production: *tripdb.TripsDetailRepo) — the same
//     read path the GET /api/v1/trips/{id} baseline handler already
//     uses.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; the evidence is a pure read of the
//     existing TripDetail aggregate.
//
//   - Privacy: the LLM is shown start_place / end_place strings as
//     redaction-tagged values (the PolicyAutoTripNaming allow-list
//     intentionally excludes ClassStreetAddr); the round-trip tags
//     are restored only in the final SSE frame returned to the same
//     authenticated user.

package trip

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TripSource is the narrow trip-header interface the auto-trip-naming
// tools need. In production it is satisfied by *tripdb.TripRepo
// wrapped through an adapter that exposes GetByID; tests substitute
// deterministic fakes.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the propose-only contract that ADR-015 §I3 +
// the slice prompt mandate.
type TripSource interface {
	// GetTripByID returns the trip header for tripID, or
	// (nil, error) if it does not exist or is not visible to the
	// caller. The error text is suitable for surfacing to the LLM
	// (it'll be relayed back as a tool error reply).
	GetTripByID(ctx context.Context, tripID int64) (*models.Trip, error)
}

// TripDetailSource is the narrow trip-detail interface the
// auto-trip-naming tools need. In production it is satisfied by
// *tripdb.TripsDetailRepo (the same read path the GET
// /api/v1/trips/{id} baseline handler already uses); tests
// substitute deterministic fakes.
type TripDetailSource interface {
	// GetTrip returns the trip detail aggregate (header +
	// constituent drives) for tripID. The detail carries the
	// per-drive StartPlace / EndPlace pair that grounds the
	// LLM's name proposal.
	GetTrip(ctx context.Context, tripID int64) (*tripdb.TripDetail, error)
}

// TripNameValidator is the narrow validation interface the
// auto-trip-naming tools need. In production it is satisfied by
// *api.AITripNameValidator (a thin wrapper around the same trimming
// + length rules a future canonical trip-update handler will
// enforce); tests substitute deterministic fakes.
//
// The interface MUST stay validation-only — adding a Save or Update
// method here would defeat the propose-only contract that ADR-015
// §I3 + the slice prompt mandate.
type TripNameValidator interface {
	// ValidateTripName reports whether proposed would be accepted
	// by the canonical trip-update path for trip. Returns nil on
	// acceptance; an error whose Error() text is suitable for
	// surfacing to the LLM on rejection.
	ValidateTripName(trip *models.Trip, proposed string) error
}

// autoTripNamingMaxNameLen is the hard cap on the proposed name's
// rune-length. Mirrors the AlertRule.Name 200-char cap so the
// surface UIs (trip detail header, modal title bar) all stay within
// one render line.
const autoTripNamingMaxNameLen = 200

// tripNameDraftInput is the typed input shape both tools share. The
// dispatcher decodes the LLM's tool-call arguments JSON into this
// struct via ValidateStruct so a malformed input fails before any
// validator method runs.
type tripNameDraftInput struct {
	// TripID is the trip the proposed name applies to. Required
	// and positive. The AI handler always scopes to the caller's
	// own trip via the URL path param; the LLM MAY propose a
	// different ID via the input, but the handler clamps the
	// scope before invoking the tool.
	TripID int64 `json:"trip_id" validate:"required,gte=1" desc:"Numeric trip ID this name applies to."`

	// ProposedName is the human-readable name the LLM proposes.
	// Capped at 200 chars to mirror the trip-name contract; at
	// least 1 char so a blank name surfaces as an LLM-side error
	// before reaching the validator.
	ProposedName string `json:"proposed_name" validate:"required,gte=1,lte=200" desc:"Proposed human-readable trip name (1-200 chars)."`
}

// tripNameEvidence is the read-only context envelope the
// draft_trip_name tool returns alongside the validated draft. The
// LLM is expected to ground its follow-up rationale in these
// fields. Numeric units are SI-canonical (meters, seconds) per
// Phase-48 — the frontend converts to user-preferred display units
// at the render boundary.
type tripNameEvidence struct {
	StartPlace  *string `json:"start_place,omitempty"`
	EndPlace    *string `json:"end_place,omitempty"`
	DriveCount  int64   `json:"drive_count"`
	DistanceM   float64 `json:"distance_m"`
	StartedAt   string  `json:"started_at"`
	EndedAt     string  `json:"ended_at,omitempty"`
	CurrentName string  `json:"current_name,omitempty"`
}

// tripNameDraftOutput is the JSON envelope draft_trip_name returns.
// The frontend renders Draft as the structured proposal in the
// TripDetailPage's AI side panel.
type tripNameDraftOutput struct {
	// Draft is the proposed trip-name shape with TripID clamped
	// to the caller's actual scope.
	Draft *tripNameDraft `json:"draft"`

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

// tripNameDraft is the proposal envelope rendered to the user. The
// `proposed_name` field is what the user reviews + (optionally
// edits) before saving via the explicit confirmation flow in the
// TripDetailPage UI.
type tripNameDraft struct {
	TripID       int64            `json:"trip_id"`
	VehicleID    int64            `json:"vehicle_id"`
	ProposedName string           `json:"proposed_name"`
	Evidence     tripNameEvidence `json:"evidence"`
}

// validateTripNameShape runs the deterministic trip-name validation
// the production validator wrapper also enforces. Extracted so the
// tool's "would this be accepted" check is byte-equivalent to the
// production wrapper without the tool needing to round-trip through
// the wrapper for every call. The production wrapper calls this
// function directly.
//
// Rules (pinned by tests):
//
//   - rune-trimmed name must be 1-200 chars;
//   - no control characters (Unicode category Cc) anywhere;
//   - leading / trailing whitespace is rejected (the user can fix
//     this by clicking the proposal into the input and saving the
//     trimmed version; we don't auto-trim because the user may have
//     intentionally added a leading emoji + space).
func validateTripNameShape(proposed string) error {
	if proposed == "" {
		return errors.New("trip name must not be empty")
	}
	if strings.TrimSpace(proposed) == "" {
		return errors.New("trip name must contain at least one non-whitespace character")
	}
	if proposed[0] == ' ' || proposed[0] == '\t' || proposed[len(proposed)-1] == ' ' || proposed[len(proposed)-1] == '\t' {
		return errors.New("trip name must not have leading or trailing whitespace")
	}
	runes := []rune(proposed)
	if len(runes) > autoTripNamingMaxNameLen {
		return errors.New("trip name must be at most 200 characters")
	}
	for _, r := range runes {
		if unicode.IsControl(r) {
			return errors.New("trip name must not contain control characters")
		}
	}
	return nil
}

// buildTripNameEvidence converts the *tripdb.TripDetail header
// into the read-only evidence envelope returned by both tools.
// Format choice: ISO-8601 UTC strings so the LLM's follow-up prose
// can quote the dates back to the user without ambiguity.
func buildTripNameEvidence(detail *tripdb.TripDetail) tripNameEvidence {
	ev := tripNameEvidence{
		DriveCount: detail.DriveCount,
		DistanceM:  detail.DistanceM,
		StartedAt:  detail.StartedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if detail.EndedAt != nil {
		ev.EndedAt = detail.EndedAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	if detail.Name != nil {
		ev.CurrentName = *detail.Name
	}
	// Use the first / last drive's place pair as the trip's
	// route signature. The drives slice is position-ordered by
	// the repo, so [0] is the first drive and [-1] is the last.
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

// draftTripName is the propose-only tool that builds a normalized +
// validated trip-name draft for the TripDetailPage UI to render. It
// is the FIRST tool the LLM is expected to call (per the strategy's
// system prompt).
//
// Execution is pure: input → typed draft → canonical validator pass
// → JSON envelope. No DB write; no SQL; no side effects beyond the
// read of TripDetail used to populate the evidence envelope.
type draftTripName struct {
	trips     TripSource
	details   TripDetailSource
	validator TripNameValidator
}

// Name implements [Tool].
func (t *draftTripName) Name() string { return "draft_trip_name" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *draftTripName) Description() string {
	return "Build a typed trip-name draft from the caller's proposed name and the trip's actual route context (start_place, end_place, drive count, distance, time window). " +
		"PROPOSE-ONLY: the name is NOT saved; the user reviews the draft in the UI before clicking Save. " +
		"Returns {draft: {trip_id, vehicle_id, proposed_name, evidence{...}}, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftTripName) InputSchema() json.RawMessage {
	return tools.CachedSchema(tripNameDraftInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftTripName) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftTripName) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream.
func (t *draftTripName) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftTripName) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[tripNameDraftInput](raw)
}

// Execute implements [Tool]. Reads the trip header + detail to build
// the evidence envelope, then runs the validator over the proposed
// name. Validation failures surface as status="invalid" in the
// envelope; a missing trip surfaces as a returned error (the LLM
// retries with a different trip_id).
func (t *draftTripName) Execute(ctx context.Context, in any) (any, error) {
	input := in.(tripNameDraftInput)
	if t.trips == nil {
		return nil, errors.New("draft_trip_name: no TripSource wired")
	}
	if t.details == nil {
		return nil, errors.New("draft_trip_name: no TripDetailSource wired")
	}
	if t.validator == nil {
		return nil, errors.New("draft_trip_name: no TripNameValidator wired")
	}

	trip, err := t.trips.GetTripByID(ctx, input.TripID)
	if err != nil {
		return nil, err
	}
	if trip == nil {
		return nil, errors.New("draft_trip_name: trip not found")
	}

	detail, err := t.details.GetTrip(ctx, input.TripID)
	if err != nil {
		return nil, err
	}
	if detail == nil {
		return nil, errors.New("draft_trip_name: trip detail not found")
	}

	draft := &tripNameDraft{
		TripID:       trip.ID,
		VehicleID:    trip.VehicleID,
		ProposedName: input.ProposedName,
		Evidence:     buildTripNameEvidence(detail),
	}

	out := &tripNameDraftOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/api/ai_auto_trip_name_handler.go AITripNameValidator",
	}
	if err := t.validator.ValidateTripName(trip, input.ProposedName); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// tripNameValidateInput is the typed input for validate_trip_name.
// Mirrors tripNameDraftInput field-for-field; kept separate so a
// future divergence (e.g. additional flags for diff-style
// validation) does not force a shared shape to grow.
type tripNameValidateInput struct {
	TripID       int64  `json:"trip_id" validate:"required,gte=1" desc:"Numeric trip ID this name applies to."`
	ProposedName string `json:"proposed_name" validate:"required,gte=1,lte=200" desc:"Proposed human-readable trip name (1-200 chars)."`
}

// tripNameValidateOutput is the envelope validate_trip_name returns.
// Mirrors tripNameDraftOutput minus the Draft field — the LLM
// already has the draft from the earlier draft_trip_name call.
type tripNameValidateOutput struct {
	Status          string `json:"status"`
	ValidationError string `json:"validation_error,omitempty"`
	Source          string `json:"source"`
}

// validateTripNameTool is the propose-only tool that runs the
// canonical trip-name validator over a typed shape and reports the
// verdict. It is the SECOND tool the LLM is expected to call (per
// the strategy's system prompt) — typically immediately after
// draft_trip_name, so the assistant can confirm the draft would
// pass before narrating it to the user.
type validateTripNameTool struct {
	trips     TripSource
	validator TripNameValidator
}

// Name implements [Tool].
func (t *validateTripNameTool) Name() string { return "validate_trip_name" }

// Description implements [Tool].
func (t *validateTripNameTool) Description() string {
	return "Run the canonical trip-name validator over a proposed name and report whether it would be accepted by the trip-update path. " +
		"PROPOSE-ONLY: nothing is saved. Returns {status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_trip_name to confirm a proposed name will be accepted before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateTripNameTool) InputSchema() json.RawMessage {
	return tools.CachedSchema(tripNameValidateInput{})
}

// OutputSchema implements [Tool].
func (t *validateTripNameTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateTripNameTool) Mutates() bool { return false }

// RequiredScope implements [Tool].
func (t *validateTripNameTool) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *validateTripNameTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[tripNameValidateInput](raw)
}

// Execute implements [Tool]. Same error semantics as
// draft_trip_name: validation failures are surfaced as
// status="invalid", never as a returned error. A missing trip is
// returned as an error so the LLM can retry with a different ID.
func (t *validateTripNameTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(tripNameValidateInput)
	if t.trips == nil {
		return nil, errors.New("validate_trip_name: no TripSource wired")
	}
	if t.validator == nil {
		return nil, errors.New("validate_trip_name: no TripNameValidator wired")
	}

	trip, err := t.trips.GetTripByID(ctx, input.TripID)
	if err != nil {
		return nil, err
	}
	if trip == nil {
		return nil, errors.New("validate_trip_name: trip not found")
	}

	out := &tripNameValidateOutput{
		Status: "ok",
		Source: "validator: internal/api/ai_auto_trip_name_handler.go AITripNameValidator",
	}
	if err := t.validator.ValidateTripName(trip, input.ProposedName); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// AutoTripNamingSources bundles the narrow read + validator
// interfaces RegisterAutoTripNamingTools needs. Mirrors
// [AlertBuilderSources] / [RouteEfficiencySuggestionsSources].
//
// Production wiring (router.go) instantiates the three production
// adapters (*tripdb.TripRepo via TripGetByIDAdapter,
// *tripdb.TripsDetailRepo, *api.AITripNameValidator); tests
// substitute deterministic fakes.
type AutoTripNamingSources struct {
	Trips     TripSource
	Details   TripDetailSource
	Validator TripNameValidator
}

// RegisterAutoTripNamingTools installs the auto-trip-naming slice's
// tools on r. Called from router.go AFTER the previous slice's tool
// registrations so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or any
// builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterAutoTripNamingTools(r *tools.Registry, s AutoTripNamingSources) {
	r.Register(&draftTripName{trips: s.Trips, details: s.Details, validator: s.Validator})
	r.Register(&validateTripNameTool{trips: s.Trips, validator: s.Validator})
}
