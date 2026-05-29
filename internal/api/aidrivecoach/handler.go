package aidrivecoach

// Per-drive coaching narrative handler.
//
// This is the opt-in LLM narration layer for POST /api/v1/ai/drives/{driveID}/coach.
// The guard returns 404 before this handler runs when AI or the feature is disabled (ADR-015 §I6).
// The drive ID stays in the URL because the surface is anchored to one drive detail page.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	drivecoaching "github.com/ev-dev-labs/teslasync/internal/ai/strategies/drive-coaching"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's tool-loop. Drive
// coaching is at most two-tool-calls-then-answer; a hard ceiling of
// 6 is generous for a model that occasionally retries one of the
// tool calls before settling. Mirrors aiAnomalyMaxIterations from
// slice 0014 with extra headroom because this strategy uses two
// tools rather than one.
const maxIterations = 6

// Handler is the HTTP handler for
// POST /api/v1/ai/drives/{driveID}/coach.
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

// NewHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_drive_detail (registered by Register12Builtins)
//	AND query_drive_telemetry_summary (registered by
//	tools.RegisterDriveCoachingTools in router.go).
//
// strat:      the drive-coaching Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aidrivecoach: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aidrivecoach: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aidrivecoach: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseDriveCoachURL extracts and validates the driveID URL
// parameter. Pulled out so the off-mode test and the validator-only
// test can exercise the same parsing without constructing a full
// handler with stub deps. The function writes a 400 on failure and
// returns the (id, ok) pair so the caller can early-return.
//
// driveID MUST be a positive integer; zero or negative values are
// rejected with a 400 because they cannot identify a real drive
// row.
func parseDriveCoachURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "driveID")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "driveID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("driveID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "driveID must be > 0")
		return 0, false
	}
	return id, true
}

// ServeHTTP implements [http.Handler]. The driveID is parsed from
// the URL, the dispatcher is invoked, and the SSE stream is closed
// via the dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the writer
// has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	driveID, ok := parseDriveCoachURL(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), drivecoaching.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai drive coach: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, drivecoaching.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(drivecoaching.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai drive coach: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, drivecoaching.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai drive coach: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// drive-coaching strategy declares only read-only tools, so the
	// confirm hook never fires — but defence-in-depth: if a future
	// strategy edit adds a mutating tool by mistake, the dispatcher
	// will REJECT it instead of silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Drive coaching is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that asks it to call its two tools and
	// narrate the result.
	//
	// Note: vehicle_id is intentionally NOT included here. The LLM
	// learns the vehicle from the tool reply (query_drive_detail
	// returns the *drivemodel.Drive whose VehicleID field is the
	// authoritative source). Including a user-controllable vehicle
	// hint in the prompt would risk cross-tenant leak via prompt
	// injection — keeping the drive_id as the sole identifier
	// removes that vector entirely.
	userMsg := fmt.Sprintf(
		"Coach drive %d. Call query_drive_detail and query_drive_telemetry_summary first, then narrate.",
		driveID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		// Errors are also surfaced on the SSE wire by the
		// dispatcher's terminal frame (WriteError or
		// EmitLimitError on the underlying writer); we just log.
		log.Error().Err(err).
			Int64("drive_id", driveID).
			Msg("ai drive coach: dispatcher returned error")
	}
}

// denyAllConfirm rejects all mutating AI tool confirmations for this read-only surface.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
