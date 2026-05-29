package aispeedprof

// Phase-50 / 0022 — D2 Speed-profile insights.
//
// handler.go implements the LLM-backed handler at
// POST /api/v1/ai/drives/{driveID}/speed-profile/insights. The flow
// mirrors the drive-coaching / YIR / digest / anomaly narration
// handlers — same dispatch+stream loop, no persistence (one-shot
// narration; no conversation to record):
//
//	URL  /api/v1/ai/drives/{driveID}/speed-profile/insights
//	  ↓
//	resolve provider via *provider.Registry.For("speed-profile-insights")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("speed-profile-insights", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// Like the drive-coaching handler (slice 0018) but unlike the
// YIR/digest/anomaly handlers, this handler takes `driveID` from
// the URL path — the AI surface attaches to a specific drive's
// detail page (/drives/:id) so the URL is the natural place for it.
// There is no JSON body; an empty body is accepted.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic SpeedHistogramChart,
//     summary metrics, hero gauges, energy
//     summary, and other panels rendered by
//     DriveDetailPage at /drives/:id are unchanged.
//     This handler is an OPT-IN add-on; off-mode users
//     never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("speed-profile-insights").
//   - I9 redaction:       PolicySpeedProfileInsights (allows
//     ClassVehicleName only; lat/long and addresses
//     stay tagged) is installed by dispatch.Run from
//     the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     JSON shape is added or modified by this slice.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	speedprofileinsights "github.com/ev-dev-labs/teslasync/internal/ai/strategies/speed-profile-insights"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most two-tool-calls-then-answer; a
// hard ceiling of 6 is generous for a model that occasionally
// retries one of the tool calls before settling. Mirrors
// aiDriveCoachMaxIterations from slice 0018 — same shape, two
// read-only tools.
const maxIterations = 6

// Handler is the HTTP handler for
// POST /api/v1/ai/drives/{driveID}/speed-profile/insights.
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
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_speed_profile AND query_drive_context
//	(both registered by tools.RegisterSpeedProfileInsightsTools
//	in router.go).
//
// strat:      the speed-profile-insights Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aispeedprof: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aispeedprof: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aispeedprof: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseSpeedProfileInsightsURL extracts and validates the driveID
// URL parameter. Pulled out so the off-mode test and the
// validator-only test can exercise the same parsing without
// constructing a full handler with stub deps. The function writes a
// 400 on failure and returns the (id, ok) pair so the caller can
// early-return.
//
// driveID MUST be a positive integer; zero or negative values are
// rejected with a 400 because they cannot identify a real drive
// row.
//
// Kept distinct from parseDriveCoachURL (slice 0018) so a future
// per-feature change to one parser does not silently change the
// other's contract — both happen to share the same validation
// today, but the two AI surfaces are independent.
func parseSpeedProfileInsightsURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
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
	// 1) Parse + validate URL parameters. Body is intentionally
	// ignored; this endpoint takes its only input from the URL.
	driveID, ok := parseSpeedProfileInsightsURL(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), speedprofileinsights.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai speed-profile insights: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, speedprofileinsights.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(speedprofileinsights.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai speed-profile insights: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, speedprofileinsights.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai speed-profile insights: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// speed-profile-insights strategy declares only read-only
	// tools, so the confirm hook never fires — but defence-in-
	// depth: if a future strategy edit adds a mutating tool by
	// mistake, the dispatcher will REJECT it instead of silently
	// mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Speed-profile insights are
	// NOT conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call its two
	// tools and narrate the result.
	//
	// Note: vehicle_id is intentionally NOT included here. The LLM
	// learns the vehicle from the tool reply (query_speed_profile
	// returns the *drivemodel.Drive's VehicleID field; query_drive_context
	// echoes the same). Including a user-controllable vehicle hint
	// in the prompt would risk cross-tenant leak via prompt
	// injection — keeping the drive_id as the sole identifier
	// removes that vector entirely.
	userMsg := fmt.Sprintf(
		"Narrate the speed profile of drive %d. Call query_speed_profile and "+
			"query_drive_context first, then narrate the result strictly from "+
			"their replies in 2-4 short paragraphs.",
		driveID,
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
			Int64("drive_id", driveID).
			Msg("ai speed-profile insights: dispatcher returned error")
	}
}

// denyAllConfirm rejects mutating tool calls for this read-only strategy.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
