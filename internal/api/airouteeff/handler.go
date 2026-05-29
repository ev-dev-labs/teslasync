package airouteeff

// Phase-50 / 0023 — D3 Route-efficiency suggestions.
//
// POST /api/v1/ai/routes/{routeID}/efficiency/suggest streams a one-shot
// narration without persistence. routeID is only an opaque positive anchor: the
// existing schema has no stable route primary key, so tools resolve owned route
// aggregates from the caller context while guard.Wrap enforces ADR-015 gating.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	routeefficiencysuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/route-efficiency-suggestions"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's tool-loop. The strategy is at
// most retrieve-then-query-then-answer (with optional retries) — a hard
// ceiling of 6 is generous.
const maxIterations = 6

// Handler is the HTTP handler for POST /api/v1/ai/routes/{routeID}/efficiency/suggest.
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

// NewHandler constructs the handler. All non-pointer arguments are
// required; the constructor panics on a nil so the wiring bug surfaces
// at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	retrieve_route_chunks AND query_route_efficiency
//	(both registered by tools.RegisterRouteEfficiencySuggestionsTools
//	in router.go).
//
// strat:      the route-efficiency-suggestions Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("airouteeff: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("airouteeff: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("airouteeff: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseRouteEfficiencySuggestionsURL extracts and validates the
// routeID URL parameter. Pulled out so the off-mode test and the
// validator-only test can exercise the same parsing without
// constructing a full handler with stub deps. The function writes
// a 400 on failure and returns the (id, ok) pair so the caller can
// early-return.
//
// routeID MUST be a positive integer; zero or negative values are
// rejected with a 400. The integer is an OPAQUE anchor — see the
// file-level comment — but it must still be well-formed.
//
// Kept distinct from parseSpeedProfileInsightsURL (slice 0022) so
// a future per-feature change to one parser does not silently
// change the other's contract — both happen to share the same
// validation today, but the two AI surfaces are independent.
func parseRouteEfficiencySuggestionsURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "routeID")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "routeID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("routeID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "routeID must be > 0")
		return 0, false
	}
	return id, true
}

// ServeHTTP implements [http.Handler]. The routeID is parsed from
// the URL, the dispatcher is invoked, and the SSE stream is closed
// via the dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the writer
// has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate URL parameters. Body is intentionally
	// ignored; this endpoint takes its only input from the URL.
	routeID, ok := parseRouteEfficiencySuggestionsURL(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back
	// gracefully.
	if _, err := h.registry.For(r.Context(), routeefficiencysuggestions.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai route-efficiency suggestions: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent;
	// that's the open-mode value the audit log treats as
	// "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, routeefficiencysuggestions.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(routeefficiencysuggestions.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai route-efficiency suggestions: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, routeefficiencysuggestions.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai route-efficiency suggestions: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// route-efficiency-suggestions strategy declares only
	// read-only tools, so the confirm hook never fires — but
	// defence-in-depth: if a future strategy edit adds a mutating
	// tool by mistake, the dispatcher will REJECT it instead of
	// silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Route-efficiency
	// suggestions are NOT conversational — there is no chat
	// history. We hand the LLM a deterministic prompt that asks
	// it to call its two tools and narrate the result.
	//
	// Note: vehicle_id is intentionally NOT included here. The
	// LLM is expected to call query_route_efficiency with the
	// vehicle_id it learns from the caller's request context
	// (the F7 RAG chunks scoped to user_subject already filter
	// by ownership, and the tool itself only returns drives the
	// caller has access to via the existing typed auth path).
	// Including a user-controllable vehicle hint in the prompt
	// would risk cross-tenant leak via prompt injection — the
	// routeID alone is the sole user-controllable anchor.
	userMsg := fmt.Sprintf(
		"Suggest lower-consumption habits and route choices for route anchor %d. "+
			"Call retrieve_route_chunks FIRST with a focused query over "+
			"{drive_summary} (the other source types are reserved for a future indexer), "+
			"then call query_route_efficiency to retrieve the SI-canonical per-route "+
			"aggregates for the vehicle in scope. Narrate the result strictly from the "+
			"tool replies in 2-4 short paragraphs, covering the dominant route, its "+
			"kWh/100mi figure, a comparison to the user's other routes when relevant, "+
			"and one or two concrete non-mutating suggestions grounded in the tool output.",
		routeID,
	)

	// 8) Run the dispatcher. The deferred WriteDone in
	// dispatch.Run closes the SSE stream cleanly on any path.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("route_id", routeID).
			Msg("ai route-efficiency suggestions: dispatcher returned error")
	}
}

// denyAllConfirm is the dispatcher's user-confirm hook. The strategy declares
// only read-only tools, so this is never called in practice; if a future edit
// accidentally adds a mutating tool, the dispatcher rejects it.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
