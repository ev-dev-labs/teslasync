package api

// Phase-50 / 0038 — G2 Suggest new geofences.
//
// ai_suggest_new_geofences_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/geofences/draft. The flow mirrors
// ai_auto_name_unnamed_locations_handler.go (URL-scoped propose-only
// labeller — same dispatch+stream loop, no persistence — one-shot
// proposal) BUT with the location_id sourced from the JSON body
// rather than from the URL: the slice's registered backend route is
// flat (`POST /api/v1/ai/geofences/draft`) per the slice prompt's
// Off-mode contract impact section, so the SPA picks the candidate
// visited-location at click time and ships it in the body.
//
//	BODY POST /api/v1/ai/geofences/draft  {"location_id": <int64>}
//	  ↓
//	resolve provider via *provider.Registry.For("suggest-new-geofences")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("suggest-new-geofences", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// The location_id JSON field is parsed + validated as a positive
// int64 BEFORE opening the SSE stream so a malformed input surfaces
// as a plain JSON 400 (rather than a streamed error frame the SPA's
// QueryError will struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic geofence list, Add
//     Geofence modal, and map rendered by GeofencesPage at /geofences
//     are unchanged. This handler is an OPT-IN add-on; off-mode users
//     never see it. The actual save flow remains POST /api/v1/geofences
//     — the LLM has NO write tool.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("suggest-new-geofences").
//   - I9 redaction:       PolicySuggestNewGeofences (allows
//     ClassVehicleName only; lat/long, addresses, and place names
//     stay tagged) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /api/v1/geofences JSON shape is added or modified by this
//     slice.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"unicode"

	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	suggestnewgeofences "github.com/ev-dev-labs/teslasync/internal/ai/strategies/suggest-new-geofences"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiSuggestNewGeofencesMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft-then-validate-then-answer
// (with optional retries) — a hard ceiling of 6 is generous. Mirrors
// aiAutoNameUnnamedLocationsMaxIterations.
const aiSuggestNewGeofencesMaxIterations = 6

// aiSuggestNewGeofencesMaxBodyBytes caps the JSON body to a few
// hundred bytes — the only field is a single int64. Mirrors the
// defensive caps the rest of the AI handlers apply to bodies that
// are otherwise tiny (the dispatcher's per-provider rate-limit
// decorator is the second line of defence).
const aiSuggestNewGeofencesMaxBodyBytes = 1 << 10 // 1 KiB

// suggestNewGeofencesMaxNameLen is the production cap on the
// proposed name's rune-length. Mirrors the geofence-name 200-char
// cap the canonical baseline geofence_handler.go's validateGeofence
// already enforces, so an AI draft is byte-equivalent to a manual
// Add Geofence form submission.
const suggestNewGeofencesMaxNameLen = 200

// suggestNewGeofencesMinRadiusM / suggestNewGeofencesMaxRadiusM
// bound the proposed circle radius. Same bounds the
// internal/ai/tools/suggest_new_geofences.go validator helper
// enforces (so a draft accepted by the tool is also accepted by
// the production validator wrapper). The lower bound rejects
// accidental zero-radius envelopes; the upper bound is generous
// enough to cover a parking lot or a small block but tight enough
// to prevent "geofence the entire metro area" mistakes.
const (
	suggestNewGeofencesMinRadiusM = 50.0
	suggestNewGeofencesMaxRadiusM = 1000.0
)

// AISuggestNewGeofencesHandler is the HTTP handler for
// POST /api/v1/ai/geofences/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AISuggestNewGeofencesHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAISuggestNewGeofencesHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewAISuggestNewGeofencesHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AISuggestNewGeofencesHandler {
	switch {
	case registry == nil:
		panic("api: NewAISuggestNewGeofencesHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAISuggestNewGeofencesHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAISuggestNewGeofencesHandler: nil strategy.Strategy")
	}
	return &AISuggestNewGeofencesHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiSuggestNewGeofencesMaxIterations,
	}
}

// suggestNewGeofencesBody is the wire shape the SPA POSTs. Only
// location_id is required; future fields (preferred_radius_m,
// preferred_name) MAY be added without changing the off-mode
// contract.
type suggestNewGeofencesBody struct {
	LocationID int64 `json:"location_id"`
}

// parseSuggestNewGeofencesBody decodes + validates the request
// body. Pulled out so the off-mode test can exercise the parsing
// without constructing a full handler with stub deps. The function
// writes a 400 on failure and returns the (id, ok) pair so the
// caller can early-return.
//
// Rules:
//
//   - body MUST be valid JSON capped at 1 KiB;
//   - location_id MUST be a positive integer.
//
// An empty / nil body is REJECTED — the SPA always carries the
// location_id; a missing field is a wiring bug, not a default.
func parseSuggestNewGeofencesBody(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required (location_id)")
		return 0, false
	}
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, aiSuggestNewGeofencesMaxBodyBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return 0, false
	}
	if int64(len(raw)) > aiSuggestNewGeofencesMaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "request body exceeds 1 KiB")
		return 0, false
	}
	if len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "request body is required (location_id)")
		return 0, false
	}
	var body suggestNewGeofencesBody
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return 0, false
	}
	if body.LocationID <= 0 {
		writeError(w, http.StatusBadRequest, "location_id must be > 0")
		return 0, false
	}
	return body.LocationID, true
}

// ServeHTTP implements [http.Handler]. The location_id is parsed
// from the body, the dispatcher is invoked, and the SSE stream is
// closed via the dispatcher's deferred WriteDone. Every error path
// either writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AISuggestNewGeofencesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the body. URL has no path params.
	locationID, ok := parseSuggestNewGeofencesBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), suggestnewgeofences.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai suggest-new-geofences: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, suggestnewgeofences.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(suggestnewgeofences.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai suggest-new-geofences: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, suggestnewgeofences.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai suggest-new-geofences: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook —
	// suggest-new-geofences has no write tools, so the deny-all
	// confirm path is unreachable in normal operation; defence in
	// depth against a future edit that accidentally adds one.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. suggest-new-geofences is
	// NOT conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call the two
	// propose-only tools and narrate the result.
	userMsg := fmt.Sprintf(
		"Propose a geofence for visited location %d. "+
			"Call draft_geofence FIRST with the location_id, your proposed concise human-readable name "+
			"(12-40 characters ideally; 200 hard cap), and a radius_m between %d and %d (250 is a "+
			"reasonable default for a parking lot or small landmark). Then call validate_geofence "+
			"on the same envelope to confirm it satisfies the geofence-shape contract. Narrate the "+
			"result in one or two sentences grounded strictly in the tool replies, naming the proposed "+
			"geofence name + radius and one short rationale that references the location's visit "+
			"pattern (visit_count, total_duration_s) or its current address_name when human-readable. "+
			"Remember: you NEVER save anything; the user reviews the structured proposal in the UI "+
			"and clicks Apply to form to copy it into the existing baseline Add Geofence form, then "+
			"saves it themselves.",
		locationID,
		int(suggestNewGeofencesMinRadiusM),
		int(suggestNewGeofencesMaxRadiusM),
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("location_id", locationID).
			Msg("ai suggest-new-geofences: dispatcher returned error")
	}
}

// Compile-time assertion: AISuggestNewGeofencesHandler satisfies
// http.Handler.
var _ http.Handler = (*AISuggestNewGeofencesHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interfaces declared by
// internal/ai/tools/suggest_new_geofences.go. Kept in the same file
// as the handler so the wiring intent is local to the slice;
// mirrors the auto-name-unnamed-locations AILocationNameValidator
// pattern.
//
// The LocationSource interface is satisfied by the existing
// *api.AILocationSource adapter wired by slice 0037 — the same
// drives-table read produces the same *geomodel.VisitedLocation
// aggregate this slice consumes. We do NOT add a duplicate adapter
// here; router.go reuses the slice-0037 instance for both
// strategies, which is the correct behaviour because the underlying
// data is the same.
// ---------------------------------------------------------------------

// AISuggestGeofenceValidator is the production
// tools.GeofenceValidator. It enforces the same trimming + length +
// control-character + radius rules that the canonical baseline
// geofence_handler.go's validateGeofence enforces, so a draft
// accepted by the AI tool is byte-equivalent to a draft that would
// be accepted by the canonical save handler.
//
// The struct is intentionally empty — the validator is a pure
// function. The receiver is kept so the production wiring is a noun
// ("the validator") in router.go and tests can substitute a fake by
// satisfying the tools.GeofenceValidator interface.
type AISuggestGeofenceValidator struct{}

// NewAISuggestGeofenceValidator constructs the validator.
func NewAISuggestGeofenceValidator() *AISuggestGeofenceValidator {
	return &AISuggestGeofenceValidator{}
}

// ValidateGeofence implements tools.GeofenceValidator.
//
// Rules (pinned by tests on both sides — production wrapper +
// in-tool helper):
//
//   - rune-trimmed name must be 1-200 chars;
//   - no control characters (Unicode category Cc) anywhere;
//   - leading / trailing whitespace is rejected;
//   - radius_m must be 50-1000 (inclusive); NaN / Inf rejected.
//
// The loc argument is currently unused by the validator — the rule
// is shape-only — but kept on the interface so a future per-location
// rule (e.g. "name must not equal another geofence's name on the
// same vehicle") can be added without rewiring callers.
func (v *AISuggestGeofenceValidator) ValidateGeofence(_ *geomodel.VisitedLocation, proposed string, radiusM float64) error {
	if proposed == "" {
		return errors.New("geofence name must not be empty")
	}
	if strings.TrimSpace(proposed) == "" {
		return errors.New("geofence name must contain at least one non-whitespace character")
	}
	if proposed[0] == ' ' || proposed[0] == '\t' ||
		proposed[len(proposed)-1] == ' ' || proposed[len(proposed)-1] == '\t' {
		return errors.New("geofence name must not have leading or trailing whitespace")
	}
	runes := []rune(proposed)
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

// Compile-time assertion: the validator satisfies the tool port.
var _ tools.GeofenceValidator = (*AISuggestGeofenceValidator)(nil)
