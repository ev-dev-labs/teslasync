package api

// Phase-50 / 0061 — GEN2 Vehicle paint preview.
//
// ai_vehicle_paint_preview_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft.
// The flow mirrors auto-trip-naming / route-efficiency-
// suggestions / drive-coaching narration handlers — same
// dispatch+stream loop, no persistence (one-shot proposal; no
// conversation to record):
//
//	URL  POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft
//	body {style_hint?: string}  (optional; empty body accepted)
//	  ↓
//	resolve provider via *provider.Registry.For("vehicle-paint-preview")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("vehicle-paint-preview", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// The vehicleID URL param is parsed + validated as a positive int64
// BEFORE opening the SSE stream so a malformed input surfaces as a
// plain JSON 400 (rather than a streamed error frame the SPA's
// QueryError will struggle to render meaningfully).
//
// The request body cap is 16 KiB — generous for an optional
// {style_hint} envelope; defends against amplification attempts.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the existing VehicleConfigSection (model,
//     trim, current exterior color, etc.) and the manual theme/
//     appearance settings on /vehicles/:vehicleId are unchanged.
//     This handler is an OPT-IN add-on; off-mode users never see
//     it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("vehicle-paint-preview").
//   - I9 redaction:       PolicyChatbot (allows NOTHING in
//     cleartext) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	vehiclepaintpreview "github.com/ev-dev-labs/teslasync/internal/ai/strategies/vehicle-paint-preview"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiVehiclePaintPreviewMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft-then-answer (with
// optional retries on validator rejection) — a hard ceiling of 6 is
// generous and matches the aiAutoTripNamingMaxIterations precedent.
const aiVehiclePaintPreviewMaxIterations = 6

// aiVehiclePaintPreviewMaxBodyBytes is the hard cap on the request
// body. 16 KiB is generous for an optional {style_hint} envelope
// and defends against amplification or accidental payload bombs.
const aiVehiclePaintPreviewMaxBodyBytes = 16 * 1024

// aiVehiclePaintPreviewMaxStyleHintLen mirrors the tool's
// paintPreviewMaxStyleHintLen so a body that would be rejected by
// the tool is rejected by the handler first (faster failure mode +
// no SSE stream opened for a doomed request).
const aiVehiclePaintPreviewMaxStyleHintLen = 80

// aiVehiclePaintPreviewRequest is the JSON body shape the handler
// accepts. Body is optional (empty body is accepted). StyleHint is
// optional free-text the LLM may quote when seeding the
// draft_paint_preview_prompt tool.
type aiVehiclePaintPreviewRequest struct {
	StyleHint string `json:"style_hint,omitempty"`
}

// AIVehiclePaintPreviewHandler is the HTTP handler for
// POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIVehiclePaintPreviewHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIVehiclePaintPreviewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_paint_preview_prompt (registered by
//	tools.RegisterVehiclePaintPreviewTools in router.go).
//
// strat:      the vehicle-paint-preview Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIVehiclePaintPreviewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIVehiclePaintPreviewHandler {
	switch {
	case registry == nil:
		panic("api: NewAIVehiclePaintPreviewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIVehiclePaintPreviewHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIVehiclePaintPreviewHandler: nil strategy.Strategy")
	}
	return &AIVehiclePaintPreviewHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiVehiclePaintPreviewMaxIterations,
	}
}

// parseAIVehiclePaintPreviewURL extracts and validates the
// vehicleID URL parameter. Pulled out so the unit tests can
// exercise the parser without constructing a full handler.
//
// vehicleID MUST be a positive integer; zero or negative values are
// rejected with a 400.
func parseAIVehiclePaintPreviewURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "vehicleID")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "vehicleID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("vehicleID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		writeError(w, http.StatusBadRequest, "vehicleID must be > 0")
		return 0, false
	}
	return id, true
}

// parseAIVehiclePaintPreviewBody extracts and validates the
// optional request JSON body. Empty body is accepted (returns the
// zero request). On parse failure writes a 4xx and returns false.
func parseAIVehiclePaintPreviewBody(w http.ResponseWriter, r *http.Request) (aiVehiclePaintPreviewRequest, bool) {
	var req aiVehiclePaintPreviewRequest
	if r.Body == nil {
		return req, true
	}
	limited := io.LimitReader(r.Body, aiVehiclePaintPreviewMaxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read request body: %v", err))
		return req, false
	}
	if int64(len(body)) > aiVehiclePaintPreviewMaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("request body exceeds %d byte cap", aiVehiclePaintPreviewMaxBodyBytes))
		return req, false
	}
	if len(body) == 0 {
		return req, true
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if len([]rune(req.StyleHint)) > aiVehiclePaintPreviewMaxStyleHintLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("style_hint must be at most %d characters", aiVehiclePaintPreviewMaxStyleHintLen))
		return req, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The vehicleID is parsed from
// the URL, the optional body is parsed, the dispatcher is invoked,
// and the SSE stream is closed via the dispatcher's deferred
// WriteDone. Every error path either writes a structured frame
// onto the SSE stream (when the writer has been opened) or a plain
// JSON 4xx/5xx (before it has).
func (h *AIVehiclePaintPreviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate URL parameters and optional body.
	vehicleID, ok := parseAIVehiclePaintPreviewURL(w, r)
	if !ok {
		return
	}
	req, ok := parseAIVehiclePaintPreviewBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back
	// gracefully.
	if _, err := h.registry.For(r.Context(), vehiclepaintpreview.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai vehicle-paint-preview: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, vehiclepaintpreview.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(vehiclepaintpreview.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai vehicle-paint-preview: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, vehiclepaintpreview.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai vehicle-paint-preview: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. The handler is NOT
	// conversational — there is no chat history. We hand the LLM
	// a deterministic prompt that asks it to call the propose-only
	// tool and narrate the result. The vehicleID from the URL is
	// the authoritative scope; the system prompt + refusal_other_vehicle
	// golden prove the LLM refuses cross-vehicle requests.
	styleClause := ""
	if req.StyleHint != "" {
		styleClause = fmt.Sprintf(" Prefer the %q style if it fits.", req.StyleHint)
	}
	userMsg := fmt.Sprintf(
		"Propose a paint-preview image prompt for vehicle %d.%s "+
			"Call draft_paint_preview_prompt with the vehicle_id, your proposed paint color "+
			"name, and the optional style hint. Narrate the result in one or two short "+
			"sentences grounded strictly in the tool's evidence, naming the proposed color "+
			"and one short rationale referencing the vehicle's model / trim / current color "+
			"(NEVER the display name, VIN, license plate, or location). Remember: you NEVER "+
			"save, upload, or apply anything; you NEVER call an external image-generation "+
			"provider; the user reviews the structured proposal in the AI panel and applies "+
			"the new paint color via the existing manual per-vehicle Color setting themselves.",
		vehicleID, styleClause,
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
			log.Info().Int64("vehicle_id", vehicleID).Msg("ai vehicle-paint-preview: dispatcher denied confirm")
			return
		}
		log.Error().Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("ai vehicle-paint-preview: dispatcher returned error")
	}
}

// Compile-time assertion: AIVehiclePaintPreviewHandler satisfies
// http.Handler.
var _ http.Handler = (*AIVehiclePaintPreviewHandler)(nil)
