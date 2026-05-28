package api

// Phase-50 / 0013 — U3 Year-in-review narration.
//
// ai_year_review_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/analytics/year-in-review/narrate. The flow is the
// same dispatch+stream loop the chatbot/digest handlers use, minus
// any persistence (a year-in-review narration is one-shot — there's
// no conversation to record):
//
//   request JSON {vehicle_id, year}
//     ↓
//   resolve provider via *provider.Registry.For("yir-narration")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("yir-narration", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic template year-in-review
//     served by GET /api/v1/analytics/year-review (rendered via the
//     SPA route /year-review/:year) is unchanged. This handler is an
//     OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by guard.Wrap("yir-narration").
//   - I9 redaction:       PolicyYearInReview (allows ClassVehicleName
//                         only) is installed by dispatch.Run from the
//                         strategy.
//   - I10 type system:    the AI surface lives entirely under
//                         /api/v1/ai/*; no field on the existing
//                         baseline JSON shape is added or modified by
//                         this slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	yirnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/yir-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiYearReviewMaxIterations bounds the dispatcher's tool-loop. YIR
// narration is one-tool-call-then-answer; a hard ceiling of 4 is
// generous for a model that occasionally retries the tool call once
// before settling. Mirrors aiDigestMaxIterations from slice 0012.
const aiYearReviewMaxIterations = 4

// AIYearReviewHandler is the HTTP handler for
// POST /api/v1/ai/analytics/year-in-review/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIYearReviewHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIYearReviewHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_year_in_review_context (registered by
//	yir.RegisterYearReviewTools in router.go).
//
// strat:      the yir-narration Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIYearReviewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIYearReviewHandler {
	switch {
	case registry == nil:
		panic("api: NewAIYearReviewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIYearReviewHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIYearReviewHandler: nil strategy.Strategy")
	}
	return &AIYearReviewHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiYearReviewMaxIterations,
	}
}

// aiYearReviewRequest is the wire shape for
// POST /api/v1/ai/analytics/year-in-review/narrate.
//
// VehicleID is required and must be > 0. Year is required and bounded
// to 2010..2100 to mirror the baseline YearReviewHandler's existing
// validation.
type aiYearReviewRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	Year      int   `json:"year"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIYearReviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiYearReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}
	if body.Year < 2010 || body.Year > 2100 {
		writeError(w, http.StatusBadRequest, "year is required and must be in 2010..2100")
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), yirnarration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai year-review: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, yirnarration.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(yirnarration.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai year-review: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, yirnarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai year-review: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with a deny-all confirm hook. The
	// YIR strategy declares only the read-only YIR tool, so the
	// confirm hook never fires — but defence-in-depth: if a
	// future strategy edit adds a mutating tool by mistake, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. YIR narration is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that asks it to call the one tool it has
	// and narrate the result.
	userMsg := fmt.Sprintf(
		"Narrate the year-in-review for vehicle %d (year=%d). "+
			"Call query_year_in_review_context first, then write a short, factual recap as slide captions.",
		body.VehicleID, body.Year,
	)

	// 8) Run the dispatcher. The deferred WriteDone in dispatch.Run
	// closes the SSE stream cleanly on any path.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		// Errors are also surfaced on the SSE wire by the
		// dispatcher's terminal frame (WriteError or
		// EmitLimitError on the underlying writer); we just log.
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("year", body.Year).
			Msg("ai year-review: dispatcher returned error")
	}
}

// Compile-time assertion: AIYearReviewHandler satisfies http.Handler.
var _ http.Handler = (*AIYearReviewHandler)(nil)

// _ is a compile-time reference to the package's denyAllConfirm
// (defined in ai_chatbot_handler.go) so a renamed identifier surfaces
// here at build time. dispatch.ConfirmFn is a function type so we
// can't assert its identity directly.
var _ = func(ctx context.Context, req dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return denyAllConfirm(ctx, req)
}
