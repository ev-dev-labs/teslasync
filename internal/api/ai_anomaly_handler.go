package api

// Phase-50 / 0014 — U4 Anomaly explanation narration.
//
// ai_anomaly_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/anomalies/explain. The flow mirrors the YIR /
// digest narration handlers — same dispatch+stream loop, no
// persistence (one-shot narration; no conversation to record):
//
//   request JSON {vehicle_id, days?}
//     ↓
//   resolve provider via *provider.Registry.For("anomaly-explanations")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("anomaly-explanations", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic Z-score detector +
//     static safeRanges-based explanation served by
//     GET /api/v1/analytics/anomalies (rendered via the SPA route
//     /anomaly-detection) is unchanged. This handler is an OPT-IN
//     add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//                         guard.Wrap("anomaly-explanations").
//   - I9 redaction:       PolicyDigest (allows ClassVehicleName only)
//                         is installed by dispatch.Run from the
//                         strategy.
//   - I10 type system:    the AI surface lives entirely under
//                         /api/v1/ai/*; no field on the existing
//                         baseline JSON shape is added or modified by
//                         this slice.

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	anomalyexplanations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/anomaly-explanations"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiAnomalyMaxIterations bounds the dispatcher's tool-loop. Anomaly
// narration is one-tool-call-then-answer; a hard ceiling of 4 is
// generous for a model that occasionally retries the tool call once
// before settling. Mirrors aiYearReviewMaxIterations from slice 0013.
const aiAnomalyMaxIterations = 4

// aiAnomalyDefaultDays mirrors the baseline anomaly handler default
// (and the tools.queryAnomalyContext.defaultAnomalyDays). Kept here
// as a separate const so the HTTP-input default is independently
// readable from the tool default — a future change that shifts the
// dashboard window won't silently shift the AI window.
const aiAnomalyDefaultDays = 7

// aiAnomalyMaxDays is the upper bound that mirrors the tool's
// validate tag (lte=30). HTTP-side validation bounces obvious bad
// input (e.g. days=365) before we ever invoke the LLM.
const aiAnomalyMaxDays = 30

// AIAnomalyHandler is the HTTP handler for
// POST /api/v1/ai/anomalies/explain.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIAnomalyHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIAnomalyHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_anomaly_context (registered by
//	tools.RegisterAnomalyTools in router.go).
//
// strat:      the anomaly-explanations Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIAnomalyHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIAnomalyHandler {
	switch {
	case registry == nil:
		panic("api: NewAIAnomalyHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIAnomalyHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIAnomalyHandler: nil strategy.Strategy")
	}
	return &AIAnomalyHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiAnomalyMaxIterations,
	}
}

// aiAnomalyRequest is the wire shape for
// POST /api/v1/ai/anomalies/explain.
//
// VehicleID is required and must be > 0. Days is optional; when
// absent or zero, defaults to aiAnomalyDefaultDays. Days must be in
// 1..aiAnomalyMaxDays when explicitly set, mirroring the tool's
// validate tag.
type aiAnomalyRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	Days      int   `json:"days,omitempty"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIAnomalyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiAnomalyRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}
	if body.Days < 0 || body.Days > aiAnomalyMaxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days must be in 0..%d (0 = default)", aiAnomalyMaxDays))
		return
	}
	days := body.Days
	if days == 0 {
		days = aiAnomalyDefaultDays
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), anomalyexplanations.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai anomaly: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, anomalyexplanations.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(anomalyexplanations.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai anomaly: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, anomalyexplanations.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai anomaly: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// anomaly strategy declares only the read-only anomaly tool, so
	// the confirm hook never fires — but defence-in-depth: if a
	// future strategy edit adds a mutating tool by mistake, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Anomaly narration is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that asks it to call the one tool it has
	// and narrate the result.
	userMsg := fmt.Sprintf(
		"Explain anomalies for vehicle %d over the last %d days. "+
			"Call query_anomaly_context first, then narrate the result strictly from its reply.",
		body.VehicleID, days,
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
			Int("days", days).
			Msg("ai anomaly: dispatcher returned error")
	}
}

// Compile-time assertion: AIAnomalyHandler satisfies http.Handler.
var _ http.Handler = (*AIAnomalyHandler)(nil)
