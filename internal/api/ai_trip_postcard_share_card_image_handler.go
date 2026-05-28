package api

// Phase-50 / 0060 — GEN1 Trip postcard and share-card image generation.
//
// ai_trip_postcard_share_card_image_handler.go implements the
// LLM-backed handler at POST /api/v1/ai/share-cards/trip-image/draft.
// The flow mirrors the auto-trip-naming / route-efficiency-
// suggestions / drive-coaching narration handlers — same
// dispatch+stream loop, no persistence (one-shot proposal; no
// conversation to record):
//
//	URL  POST /api/v1/ai/share-cards/trip-image/draft
//	body {trip_id: int64, style_hint?: string}
//	  ↓
//	resolve provider via *provider.Registry.For("trip-postcard-share-card-image-generation")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("trip-postcard-share-card-image-generation", …) so
// when ai_mode='off' or the per-feature toggle is off the guard
// returns 404 BEFORE this handler ever sees the request
// (ADR-015 §I6).
//
// The trip_id is parsed from the JSON body BEFORE opening the SSE
// stream so a malformed input surfaces as a plain JSON 400 (rather
// than a streamed error frame the SPA's QueryError will struggle
// to render meaningfully).
//
// The request body cap is 16 KiB — generous for a typed payload
// of {trip_id, style_hint}; defends against amplification attempts.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the existing static share-card / shared-
//     drive route (/s/:token, SharedDrivePage) and the manual
//     share-link controls (generate static link, copy link, list
//     active links, revoke) are unchanged. This handler is an
//     OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("trip-postcard-share-card-image-generation").
//   - I9 redaction:       PolicyDigest (allows ClassVehicleName
//     only; lat/long, addresses, and place names stay tagged) is
//     installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	trippostcardsharecardimagegeneration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/trip-postcard-share-card-image-generation"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiTripPostcardShareCardImageGenerationMaxIterations bounds the
// dispatcher's tool-loop. The strategy is at most draft-then-
// render-then-answer (with optional retries on validator
// rejection) — a hard ceiling of 6 is generous and matches the
// aiAutoTripNamingMaxIterations precedent.
const aiTripPostcardShareCardImageGenerationMaxIterations = 6

// aiTripPostcardShareCardImageGenerationMaxBodyBytes is the hard
// cap on the request body. 16 KiB is generous for a typed JSON
// envelope of {trip_id, style_hint} and defends against
// amplification or accidental payload bombs.
const aiTripPostcardShareCardImageGenerationMaxBodyBytes = 16 * 1024

// aiTripPostcardShareCardImageGenerationRequest is the JSON body
// shape the handler accepts. TripID is required (positive int64).
// StyleHint is optional free-text the LLM may quote when seeding
// the draft_image_prompt tool.
type aiTripPostcardShareCardImageGenerationRequest struct {
	TripID    int64  `json:"trip_id"`
	StyleHint string `json:"style_hint,omitempty"`
}

// AITripPostcardShareCardImageGenerationHandler is the HTTP handler
// for POST /api/v1/ai/share-cards/trip-image/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AITripPostcardShareCardImageGenerationHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAITripPostcardShareCardImageGenerationHandler constructs the
// handler. All non-pointer arguments are required; the constructor
// panics on a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_image_prompt AND render_share_card_preview (both
//	registered by trip.RegisterTripPostcardShareCardImageGenerationTools
//	in router.go).
//
// strat:      the trip-postcard-share-card-image-generation
//
//	Strategy (one per process).
//
// headerName: forward-auth header name; used to extract subject for audit.
func NewAITripPostcardShareCardImageGenerationHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AITripPostcardShareCardImageGenerationHandler {
	switch {
	case registry == nil:
		panic("api: NewAITripPostcardShareCardImageGenerationHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAITripPostcardShareCardImageGenerationHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAITripPostcardShareCardImageGenerationHandler: nil strategy.Strategy")
	}
	return &AITripPostcardShareCardImageGenerationHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiTripPostcardShareCardImageGenerationMaxIterations,
	}
}

// parseAITripPostcardShareCardImageGenerationBody extracts and
// validates the request JSON body. Pulled out so the unit tests can
// exercise the parser without constructing a full handler. The
// function writes a 4xx on failure and returns (request, true) on
// success; the caller early-returns on the false case.
//
// TripID MUST be a positive integer; zero or negative values are
// rejected with a 400. StyleHint is bounded to 80 chars to match
// the tool's input schema.
func parseAITripPostcardShareCardImageGenerationBody(w http.ResponseWriter, r *http.Request) (aiTripPostcardShareCardImageGenerationRequest, bool) {
	var req aiTripPostcardShareCardImageGenerationRequest
	limited := io.LimitReader(r.Body, aiTripPostcardShareCardImageGenerationMaxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read request body: %v", err))
		return req, false
	}
	if int64(len(body)) > aiTripPostcardShareCardImageGenerationMaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("request body exceeds %d byte cap", aiTripPostcardShareCardImageGenerationMaxBodyBytes))
		return req, false
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "request body required (expected {\"trip_id\": <int>, \"style_hint\": <string?>})")
		return req, false
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.TripID <= 0 {
		writeError(w, http.StatusBadRequest, "trip_id must be > 0")
		return req, false
	}
	if len([]rune(req.StyleHint)) > 80 {
		writeError(w, http.StatusBadRequest, "style_hint must be at most 80 characters")
		return req, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The request body is parsed,
// the dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AITripPostcardShareCardImageGenerationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate request body.
	req, ok := parseAITripPostcardShareCardImageGenerationBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back
	// gracefully.
	if _, err := h.registry.For(r.Context(), trippostcardsharecardimagegeneration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai trip-postcard: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, trippostcardsharecardimagegeneration.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(trippostcardsharecardimagegeneration.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai trip-postcard: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, trippostcardsharecardimagegeneration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai trip-postcard: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. The handler is NOT
	// conversational — there is no chat history. We hand the LLM
	// a deterministic prompt that asks it to call the two
	// propose-only tools and narrate the result.
	styleClause := ""
	if req.StyleHint != "" {
		styleClause = fmt.Sprintf(" Prefer the %q style if it fits the trip's character.", req.StyleHint)
	}
	userMsg := fmt.Sprintf(
		"Propose a concise share-card title and a single image-generation prompt for trip %d.%s "+
			"Call draft_image_prompt FIRST with the trip_id (and your chosen style_hint if any), then call "+
			"render_share_card_preview with a refined proposed_title and image_prompt to confirm the proposal "+
			"satisfies the share-card contract. Narrate the result in one or two sentences grounded strictly in "+
			"the tool replies, naming the proposed title and one short rationale that references the trip's "+
			"start_place/end_place pair or time window. Remember: you NEVER save, upload, share, or publish "+
			"anything; you NEVER call an external image-generation provider; the user reviews the structured "+
			"proposal in the UI and applies it via the existing manual share-link controls themselves.",
		req.TripID, styleClause,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		// A canceled context is a normal client-disconnect /
		// SSE-cancel signal; don't pollute logs at error level.
		if errors.Is(err, dispatch.ErrConfirmationDenied) {
			log.Info().Int64("trip_id", req.TripID).Msg("ai trip-postcard: dispatcher denied confirm")
			return
		}
		log.Error().Err(err).
			Int64("trip_id", req.TripID).
			Msg("ai trip-postcard: dispatcher returned error")
	}
}

// Compile-time assertion: AITripPostcardShareCardImageGenerationHandler
// satisfies http.Handler.
var _ http.Handler = (*AITripPostcardShareCardImageGenerationHandler)(nil)
