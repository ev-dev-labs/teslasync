package aisearch

// Phase-50 / 0017 — N3 Natural-language search across drives, charges,
// and alerts.
//
// handler.go implements the LLM-backed handler at
// POST /api/v1/ai/search/query. The flow mirrors the
// nl-automation-builder handler from slice 0016 — same
// dispatch+stream loop, same propose-only-via-read-only-tools
// contract, no persistence (one-shot search; no conversation to
// record):
//
//   request JSON {prompt}
//     ↓
//   resolve provider via *provider.Registry.For("nl-search")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("nl-search", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// READ-only contract (slice prompt + ADR-015 §I3):
//
//   - Both tools the strategy declares (retrieve_chunks,
//     hydrate_search_result) are READ-only ports — the F7
//     rag.Retriever for the corpus lookup, a narrow Hydrator port
//     for one-by-one detail rendering. Neither writes any state.
//   - The deterministic /search baseline + SearchHandler.Search at
//     internal/api/search_handler.go remains the canonical typed
//     search path for any user with `ai_mode='off'`.
//   - The cited entities link back to the same SPA detail pages
//     (/drives/:id, /charging/:id, /notifications/:id) the typed
//     baseline already exposes — no new entity-detail surface is
//     introduced by this slice.
//
// ADR-015 alignment:
//
//   - I1 default-off:    the feature toggle defaults false in
//                         features.Registry; the guard fails closed.
//   - I3 baseline intact: this handler never replaces the typed
//                         GET /api/v1/search path served by
//                         SearchHandler.Search.
//   - I7 per-feature:     the AI route is gated by
//                         guard.Wrap("nl-search").
//   - I9 redaction:       PolicyChatbot (deny-all, ModeRedactedTags)
//                         is installed by dispatch.Run from the
//                         strategy.
//   - I10 type system:    the AI surface lives entirely under
//                         /api/v1/ai/*; no field on the existing
//                         baseline JSON shape is added or modified
//                         by this slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	nlsearch "github.com/ev-dev-labs/teslasync/internal/ai/strategies/nl-search"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's tool-loop. The
// nl-search strategy is typically a 1-3 step sequence (one
// retrieve_chunks call, then 0-2 hydrate_search_result calls for the
// top hits, then narrate). A hard ceiling of 6 is generous for an
// LLM that occasionally hydrates several results before settling.
// Mirrors aiAutomationBuilderMaxIterations from slice 0016.
const maxIterations = 6

// maxPromptChars bounds the user-supplied natural-language
// query at the HTTP boundary. Generous for a multi-sentence search
// prompt; defensive against an enormous payload that would inflate
// the LLM's context window cost without any plausible legitimate
// use. Matches the per-tool query cap so the boundaries align.
const maxPromptChars = 4096

// Handler is the HTTP handler for
// POST /api/v1/ai/search/query.
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
//	retrieve_chunks + hydrate_search_result
//	(registered by tools.RegisterSearchTools in router.go).
//
// strat:      the nl-search Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aisearch: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aisearch: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aisearch: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// queryRequest is the wire shape for
// POST /api/v1/ai/search/query.
//
// Prompt is the user's plain-language search query, capped at
// maxPromptChars. The slice deliberately does NOT accept a
// vehicle_id — the F7 retriever scopes by user_subject (the
// authenticated principal) and has no per-vehicle filter; adding a
// vehicle_id field to the wire shape would create a UI affordance
// we cannot enforce server-side. See the rubber-duck critique in
// the slice plan for the full rationale.
type queryRequest struct {
	Prompt string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body queryRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		httpx.WriteError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > maxPromptChars {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", maxPromptChars))
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), nlsearch.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai search: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, nlsearch.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(nlsearch.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai search: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, nlsearch.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai search: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// nl-search strategy declares only READ-only tools
	// (retrieve_chunks, hydrate_search_result); neither writes any
	// state. The confirm hook is wired anyway as defence-in-depth:
	// if a future edit accidentally adds a mutating tool, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. We hand the LLM:
	//    - the verbatim user prompt;
	//    - the deterministic call-sequence directive (retrieve_chunks
	//      first, then hydrate top hits) so the model exercises both
	//      tools in the canonical order.
	// The strategy's system prompt does the rest of the framing
	// (refuse cross-user, no SQL, no fabrication, etc.).
	userMsg := fmt.Sprintf(
		"Search the user's records for: %q. Call retrieve_chunks first with the appropriate "+
			"source_types from {drive_summary, charge_session, alert_history}, then call "+
			"hydrate_search_result for each top hit you cite, then write a concise narration "+
			"that names the cited entities by their hydrated titles. If retrieve_chunks "+
			"returns zero matches, say so plainly and suggest a rephrase or broader window — "+
			"do NOT fabricate a result.",
		prompt,
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
			Int("prompt_chars", len(prompt)).
			Msg("ai search: dispatcher returned error")
	}
}

// denyAllConfirm rejects every mutating tool call for this read-only strategy.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)
