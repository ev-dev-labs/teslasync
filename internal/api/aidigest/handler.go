package aidigest

// Handler for weekly digest narration.
//
// This LLM-backed SSE handler is an opt-in AI surface; the deterministic
// weekly digest endpoint remains the baseline path when AI is disabled.
// guard.Wrap("digest-narration") owns ADR-015 feature gating.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	digestnarration "github.com/ev-dev-labs/teslasync/internal/ai/strategies/digest-narration"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's tool-loop. Digest
// narration is one-tool-call-then-answer; a hard ceiling of 4 is
// generous for a model that occasionally retries the tool call once
// before settling. Tested by the digest handler integration coverage.
const maxIterations = 4

// Handler is the HTTP handler for
// POST /api/v1/ai/digests/weekly/narrate.
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

// NewHandler constructs the handler and panics on boot-time wiring bugs.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aidigest: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aidigest: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aidigest: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// narrationRequest is the wire shape for
// POST /api/v1/ai/digests/weekly/narrate.
//
// VehicleID is required and must be > 0. WeekOffsetWeeks defaults to
// 0 (the current UTC ISO week) when omitted; only [-12, 0] is supported.
type narrationRequest struct {
	VehicleID       int64 `json:"vehicle_id"`
	WeekOffsetWeeks int   `json:"week_offset_weeks"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "ai.digest.narrate")
	defer span.End()
	r = r.WithContext(ctx)
	traceID := span.SpanContext().TraceID().String()

	// 1) Decode + validate request body.
	var body narrationRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}
	if body.WeekOffsetWeeks < -12 || body.WeekOffsetWeeks > 0 {
		httpx.WriteError(w, http.StatusBadRequest, "week_offset_weeks must be between -12 and 0 (UTC ISO weeks)")
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), digestnarration.FeatureID); err != nil {
		log.Error().Err(err).Str("trace_id", traceID).Msg("ai digest: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx = provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, digestnarration.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(digestnarration.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Str("trace_id", traceID).Msg("ai digest: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, digestnarration.FeatureID)
	if err != nil {
		log.Error().Err(err).Str("trace_id", traceID).Msg("ai digest: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with a deny-all confirm hook. The
	// digest strategy declares only the read-only digest tool, so
	// the confirm hook never fires — but defence-in-depth: if a
	// future strategy edit adds a mutating tool by mistake, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	scopedTools := tools.NewRegistry()
	for _, tool := range h.tools.All() {
		if tool.Name() == "query_weekly_digest_context" {
			scopedTools.Register(scopedDigestTool{Tool: tool, scope: body})
		} else {
			scopedTools.Register(tool)
		}
	}
	d := dispatch.New(scopedTools, prov, denyAllConfirm, h.maxIters)

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
		log.Error().Err(err).Str("trace_id", traceID).Int64("vehicle_id", body.VehicleID).Msg("ai digest: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)

// Do not let model-selected arguments substitute another vehicle or week.
type scopedDigestTool struct {
	tools.Tool
	scope narrationRequest
}

func (t scopedDigestTool) Validate(raw json.RawMessage) (any, error) {
	var requested narrationRequest
	if err := json.Unmarshal(raw, &requested); err != nil {
		return nil, fmt.Errorf("decode digest scope: %w", err)
	}
	if requested != t.scope {
		return nil, fmt.Errorf("digest tool must use vehicle_id=%d and week_offset_weeks=%d", t.scope.VehicleID, t.scope.WeekOffsetWeeks)
	}
	return t.Tool.Validate(raw)
}

// denyAllConfirm is the dispatcher's user-confirm hook. Digest narration
// declares only a read-only tool, so this is defence-in-depth against future
// strategy edits accidentally adding a mutating tool.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}
