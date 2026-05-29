package aidrivesearch

// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// ai_drive_search_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/drives/search. The flow mirrors the nl-search
// handler from slice 0017 — same dispatch+stream loop, same
// propose-only-via-read-only-tools contract, no persistence
// (one-shot search; no conversation to record):
//
//   request JSON {prompt}
//     ↓
//   resolve provider via *provider.Registry.For("nl-drive-search-replay")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-drive-search-replay", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// READ-only contract (slice prompt + ADR-015 §I3):
//
//   - Both tools the strategy declares (retrieve_drive_chunks,
//     hydrate_drive_replay) are READ-only ports — the F7
//     rag.Retriever for the corpus lookup, a narrow
//     DriveReplayHydrator port for one-by-one detail rendering.
//     Neither writes any state.
//   - The deterministic /drives baseline (DrivesListPage typed
//     filters: range picker, vehicle select, search input, anomaly
//     callouts) AND the existing /drives/:id/replay TripReplayPage
//     controls remain the canonical baseline path for any user
//     with `ai_mode='off'`.
//   - The cited entities link back to the same SPA detail pages
//     (/drives/:id) and the same replay scrubber
//     (/drives/:id/replay) the typed baseline already exposes —
//     no new entity-detail surface is introduced by this slice.
//
// ADR-015 alignment:
//
//   - I1 default-off:    the feature toggle defaults false in
//     features.Registry; the guard fails closed.
//   - I3 baseline intact: this handler never replaces the typed
//     DrivesListPage filters or the TripReplayPage controls. The
//     baseline GET /drives + GET /drives/:id read paths are
//     untouched.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("nl-drive-search-replay").
//   - I9 redaction:       PolicyChatbot (deny-all, ModeRedactedTags)
//     is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	nldrivesearchreplay "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-drive-search-replay"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiDriveSearchMaxIterations bounds the dispatcher's tool-loop. The
// nl-drive-search-replay strategy is typically a 1-3 step sequence
// (one retrieve_drive_chunks call, then 0-2 hydrate_drive_replay
// calls for the top hits, then narrate with replay anchors). A hard
// ceiling of 6 is generous for an LLM that occasionally hydrates
// several drives before settling. Mirrors aiSearchMaxIterations.
const aiDriveSearchMaxIterations = 6

// aiDriveSearchMaxPromptChars bounds the user-supplied
// natural-language query at the HTTP boundary. Generous for a
// multi-sentence search prompt; defensive against an enormous
// payload that would inflate the LLM's context window cost without
// any plausible legitimate use.
const aiDriveSearchMaxPromptChars = 4096

// Handler is the HTTP handler for
// POST /api/v1/ai/drives/search.
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
//	retrieve_drive_chunks + hydrate_drive_replay
//	(registered by trip.RegisterDriveSearchTools in router.go).
//
// strat:      the nl-drive-search-replay Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aidrivesearch: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aidrivesearch: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aidrivesearch: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiDriveSearchMaxIterations,
	}
}

// aiDriveSearchRequest is the wire shape for
// POST /api/v1/ai/drives/search.
//
// Prompt is the user's plain-language drive search query, capped at
// aiDriveSearchMaxPromptChars. The slice deliberately does NOT
// accept a vehicle_id — the F7 retriever scopes by user_subject
// (the authenticated principal) and has no per-vehicle filter;
// adding a vehicle_id field to the wire shape would create a UI
// affordance we cannot enforce server-side (same rationale as
// nl-search).
type aiDriveSearchRequest struct {
	Prompt string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiDriveSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		httpx.WriteError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > aiDriveSearchMaxPromptChars {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", aiDriveSearchMaxPromptChars))
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), nldrivesearchreplay.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai drive search: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nldrivesearchreplay.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nldrivesearchreplay.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai drive search: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, nldrivesearchreplay.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai drive search: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// nl-drive-search-replay strategy declares only READ-only tools
	// (retrieve_drive_chunks, hydrate_drive_replay); neither writes
	// any state. The confirm hook is wired anyway as
	// defence-in-depth: if a future edit accidentally adds a
	// mutating tool, the dispatcher will REJECT it instead of
	// silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. We hand the LLM:
	//    - the verbatim user prompt;
	//    - the deterministic call-sequence directive
	//      (retrieve_drive_chunks first, then hydrate_drive_replay
	//      for each cited drive) so the model exercises both tools
	//      in the canonical order, with replay anchors in the
	//      final narration.
	// The strategy's system prompt does the rest of the framing
	// (refuse cross-user, no SQL, no fabrication, etc.).
	userMsg := fmt.Sprintf(
		"Search the user's drive history for: %q. Call retrieve_drive_chunks first with the "+
			"appropriate source_types from {drive_summary, route_segment, location_summary}, then "+
			"call hydrate_drive_replay for each top hit you cite, then write a concise narration "+
			"that names the cited drives by their hydrated titles AND surfaces the replay anchor "+
			"(replay_url, which points at /drives/{id}/replay). If retrieve_drive_chunks returns "+
			"zero matches, say so plainly and suggest a rephrase or broader window — do NOT "+
			"fabricate a drive.",
		prompt,
	)

	// 8) Run the dispatcher. The deferred WriteDone in dispatch.Run
	// closes the SSE stream cleanly on any path.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int("prompt_chars", len(prompt)).
			Msg("ai drive search: dispatcher returned error")
	}
}

// denyAllConfirm is the dispatch confirm hook for this read-only AI surface.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
