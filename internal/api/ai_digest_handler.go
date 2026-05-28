package api

// Phase-50 / 0012 — U2 Weekly digest narration.
//
// ai_digest_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/digests/weekly/narrate. The flow is the same
// dispatch+stream loop the chatbot uses, minus the persistence (a
// digest narration is one-shot — there's no conversation to record):
//
//   request JSON {vehicle_id, week_offset_weeks?}
//     ↓
//   resolve provider via *provider.Registry.For("digest-narration")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("digest-narration", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic template digest at
//     GET /api/v1/vehicles/{id}/weekly-digest is unchanged. This
//     handler is an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by guard.Wrap("digest-narration").
//   - I9 redaction:       PolicyDigest (allows ClassVehicleName only)
//                         is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under /api/v1/ai/*;
//                         no field on the existing baseline JSON shape
//                         is added or modified by this slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	digestnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/digest-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiDigestMaxIterations bounds the dispatcher's tool-loop. Digest
// narration is one-tool-call-then-answer; a hard ceiling of 4 is
// generous for a model that occasionally retries the tool call once
// before settling. Tested in TestAIDigestHandler_OnPathDispatches.
const aiDigestMaxIterations = 4

// AIDigestHandler is the HTTP handler for
// POST /api/v1/ai/digests/weekly/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIDigestHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIDigestHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_weekly_digest_context (registered by
//	digest.RegisterDigestTools in router.go).
//
// strat:      the digest-narration Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIDigestHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIDigestHandler {
	switch {
	case registry == nil:
		panic("api: NewAIDigestHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIDigestHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIDigestHandler: nil strategy.Strategy")
	}
	return &AIDigestHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiDigestMaxIterations,
	}
}

// aiDigestRequest is the wire shape for
// POST /api/v1/ai/digests/weekly/narrate.
//
// VehicleID is required and must be > 0. WeekOffsetWeeks defaults to
// 0 (the current ISO week) when omitted; the tool's own validator
// enforces the [-12, 0] range.
type aiDigestRequest struct {
	VehicleID       int64 `json:"vehicle_id"`
	WeekOffsetWeeks int   `json:"week_offset_weeks"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIDigestHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiDigestRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), digestnarration.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai digest: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, digestnarration.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(digestnarration.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai digest: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, digestnarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai digest: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with a deny-all confirm hook. The
	// digest strategy declares only the read-only digest tool, so
	// the confirm hook never fires — but defence-in-depth: if a
	// future strategy edit adds a mutating tool by mistake, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Digest narration is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that asks it to call the one tool it has
	// and narrate the result.
	userMsg := fmt.Sprintf(
		"Narrate the weekly digest for vehicle %d (week_offset_weeks=%d). "+
			"Call query_weekly_digest_context first, then write a short, factual recap.",
		body.VehicleID, body.WeekOffsetWeeks,
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
		log.Error().Err(err).Int64("vehicle_id", body.VehicleID).Msg("ai digest: dispatcher returned error")
	}
}

// Compile-time assertion: AIDigestHandler satisfies http.Handler.
var _ http.Handler = (*AIDigestHandler)(nil)

// _ is a compile-time reference to the package's denyAllConfirm
// (defined in ai_chatbot_handler.go) so a renamed identifier surfaces
// here at build time. dispatch.ConfirmFn is a function type so we
// can't assert its identity directly.
var _ = func(ctx context.Context, req dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return denyAllConfirm(ctx, req)
}
