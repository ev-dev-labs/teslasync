package aisuggeo

// G2 suggest new geofences.
//
// This opt-in POST /api/v1/ai/geofences/draft surface streams one-shot
// geofence drafts for a body-supplied location_id. The guard in ai_routes.go
// enforces ADR-015 off-mode/per-feature gating, and validation happens before
// SSE opens so malformed input returns a normal JSON 400.
//
// The AI surface is propose-only: deterministic geofence CRUD remains the
// baseline save path, and the LLM has no write tool.

import (
	"context"
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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/location"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiSuggestNewGeofencesMaxIterations leaves room for draft/validate retries
// while bounding the tool loop.
const aiSuggestNewGeofencesMaxIterations = 6

// aiSuggestNewGeofencesMaxBodyBytes keeps the single-id JSON body tiny; the
// provider rate limiter is the second line of defense.
const aiSuggestNewGeofencesMaxBodyBytes = 1 << 10 // 1 KiB

// suggestNewGeofencesMaxNameLen mirrors the manual geofence validator so AI
// drafts and form submissions share the same cap.
const suggestNewGeofencesMaxNameLen = 200

// suggestNewGeofencesMinRadiusM / suggestNewGeofencesMaxRadiusM mirror the
// tool validator: large enough for a parking lot, small enough to reject
// metro-area drafts.
const (
	suggestNewGeofencesMinRadiusM = 50.0
	suggestNewGeofencesMaxRadiusM = 1000.0
)

// Handler is the HTTP handler for
// POST /api/v1/ai/geofences/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aisuggeo: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aisuggeo: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aisuggeo: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
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

// parseSuggestNewGeofencesBody decodes and validates the body before SSE
// starts, returning plain JSON 400s for malformed input. A missing location_id
// is rejected because the SPA must choose the candidate explicitly.
func parseSuggestNewGeofencesBody(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required (location_id)")
		return 0, false
	}
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, aiSuggestNewGeofencesMaxBodyBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "failed to read request body")
		return 0, false
	}
	if int64(len(raw)) > aiSuggestNewGeofencesMaxBodyBytes {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "request body exceeds 1 KiB")
		return 0, false
	}
	if len(raw) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required (location_id)")
		return 0, false
	}
	var body suggestNewGeofencesBody
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return 0, false
	}
	if body.LocationID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "location_id must be > 0")
		return 0, false
	}
	return body.LocationID, true
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ServeHTTP implements [http.Handler]. The location_id is parsed
// from the body, the dispatcher is invoked, and the SSE stream is
// closed via the dispatcher's deferred WriteDone. Every error path
// either writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, suggestnewgeofences.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(suggestnewgeofences.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai suggest-new-geofences: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
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

	// Deny-all confirmation is defense in depth if a future edit adds a
	// mutating tool by mistake.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Use a deterministic one-shot prompt; this surface has no chat history.
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

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)

// Production wiring stays next to the handler so the slice's tool-port intent
// is local. router.go reuses the shared LocationSource because both
// strategies consume the same VisitedLocation aggregate.

// SuggestGeofenceValidator enforces the same shape rules as the baseline
// geofence save handler. The empty receiver keeps production wiring and tests
// behind the location.GeofenceValidator interface.
type SuggestGeofenceValidator struct{}

// NewSuggestGeofenceValidator constructs the validator.
func NewSuggestGeofenceValidator() *SuggestGeofenceValidator {
	return &SuggestGeofenceValidator{}
}

// ValidateGeofence implements location.GeofenceValidator. The loc argument is
// reserved for future per-location rules; today's checks are shape-only and
// match the in-tool helper.
func (v *SuggestGeofenceValidator) ValidateGeofence(_ *geomodel.VisitedLocation, proposed string, radiusM float64) error {
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
var _ location.GeofenceValidator = (*SuggestGeofenceValidator)(nil)
