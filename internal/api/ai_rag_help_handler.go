package api

// Phase-50 / 0020 — N6 RAG-backed app help.
//
// ai_rag_help_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/help/query. The flow mirrors the nl-search
// handler from slice 0017 — same dispatch+stream loop, same
// propose-only-via-read-only-tools contract, no persistence
// (one-shot help question; no conversation to record):
//
//   request JSON {prompt}
//     ↓
//   resolve provider via *provider.Registry.For("rag-help")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("rag-help", …) so when ai_mode='off' or the per-
// feature toggle is off the guard returns 404 BEFORE this handler
// ever sees the request (ADR-015 §I6).
//
// READ-only contract (slice prompt + ADR-015 §I3):
//
//   - Both tools the strategy declares (retrieve_docs,
//     cite_help_chunk) are READ-only ports — the F7 rag.Retriever
//     scoped to the GLOBAL help corpus (user_subject="" rows the
//     F7 docs_indexer writes), and a pure formatter with no
//     external dependencies. Neither writes any state.
//   - The deterministic /help baseline served by the SPA's
//     HelpPage at web/src/features/system/pages/HelpPage.tsx
//     (curated links to /docs/*, /system-status, /chatbot,
//     /search, /onboarding plus existing tooltips and i18n help
//     copy) remains the canonical help path for any user with
//     `ai_mode='off'`.
//   - The cited entities link back to the same SPA pages the
//     deterministic baseline already exposes — no new entity-
//     detail surface is introduced by this slice.
//
// ADR-015 alignment:
//
//   - I1 default-off:    the feature toggle defaults false in
//                         features.Registry; the guard fails closed.
//   - I3 baseline intact: this handler never replaces the static
//                         HelpPage. Off-mode users hit the curated
//                         deterministic links and existing in-app
//                         tooltips instead.
//   - I7 per-feature:     the AI route is gated by
//                         guard.Wrap("rag-help").
//   - I9 redaction:       PolicyChatbot (deny-all, ModeRedactedTags)
//                         is installed by dispatch.Run from the
//                         strategy. App docs and i18n keys carry
//                         no PII today; the policy is a defence-
//                         in-depth contract pin.
//   - I10 type system:    the AI surface lives entirely under
//                         /api/v1/ai/*; no field on the existing
//                         baseline JSON shape is added or modified
//                         by this slice.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	raghelp "github.com/ev-dev-labs/teslasync/internal/ai/strategies/rag-help"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiRagHelpMaxIterations bounds the dispatcher's tool-loop. The
// rag-help strategy is typically a 1-3 step sequence (one
// retrieve_docs call, then 0-2 cite_help_chunk calls for the
// chunks the model decides to cite, then narrate). A hard ceiling
// of 6 is generous for an LLM that occasionally cites several
// chunks before settling. Mirrors aiSearchMaxIterations.
const aiRagHelpMaxIterations = 6

// aiRagHelpMaxPromptChars bounds the user-supplied natural-
// language query at the HTTP boundary. Generous for a multi-
// sentence help question; defensive against an enormous payload
// that would inflate the LLM's context window cost without any
// plausible legitimate use. Matches the per-tool query cap so the
// boundaries align.
const aiRagHelpMaxPromptChars = 4096

// AIRAGHelpHandler is the HTTP handler for
// POST /api/v1/ai/help/query.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AIRAGHelpHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIRAGHelpHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	retrieve_docs + cite_help_chunk
//	(registered by tools.RegisterHelpTools in router.go).
//
// strat:      the rag-help Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIRAGHelpHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIRAGHelpHandler {
	switch {
	case registry == nil:
		panic("api: NewAIRAGHelpHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIRAGHelpHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIRAGHelpHandler: nil strategy.Strategy")
	}
	return &AIRAGHelpHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiRagHelpMaxIterations,
	}
}

// aiRagHelpRequest is the wire shape for
// POST /api/v1/ai/help/query.
//
// Prompt is the user's plain-language help question, capped at
// aiRagHelpMaxPromptChars. The slice deliberately does NOT accept
// a vehicle_id or any user-scoped filter — the help corpus is
// GLOBAL (docs/runbooks/i18n carry no PII per the slice prompt's
// evidence section) so per-vehicle scoping would create a UI
// affordance we cannot enforce server-side.
type aiRagHelpRequest struct {
	Prompt string `json:"prompt"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIRAGHelpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiRagHelpRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > aiRagHelpMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", aiRagHelpMaxPromptChars))
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), raghelp.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai rag-help: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	// NOTE: the help corpus is GLOBAL and the retrieve_docs tool
	// passes user_subject="" to the retriever regardless of this
	// value. The subject installed here is purely for AI audit
	// log + per-user rate-limit accounting.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, raghelp.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(raghelp.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai rag-help: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, raghelp.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai rag-help: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// rag-help strategy declares only READ-only tools
	// (retrieve_docs, cite_help_chunk); neither writes any state.
	// The confirm hook is wired anyway as defence-in-depth: if a
	// future edit accidentally adds a mutating tool, the
	// dispatcher will REJECT it instead of silently mutating
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. We hand the LLM:
	//    - the verbatim user prompt;
	//    - the deterministic call-sequence directive (retrieve_docs
	//      first, then optionally cite_help_chunk per cited chunk)
	//      so the model exercises the canonical order.
	// The strategy's system prompt does the rest of the framing
	// (no SQL, no fabrication, refuse mutations, etc.).
	userMsg := fmt.Sprintf(
		"Answer the following help question: %q. Call retrieve_docs first with the appropriate "+
			"source_types from {docs, runbooks, i18n}, then optionally call cite_help_chunk for "+
			"each chunk you cite, then write a concise 2-4 paragraph answer followed by a short "+
			"citations list naming each cited chunk by source_type and source_id. If retrieve_docs "+
			"returns zero matches, say so plainly and suggest a rephrase or point at the static "+
			"help links — do NOT fabricate a docs path or i18n key.",
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
			Msg("ai rag-help: dispatcher returned error")
	}
}

// Compile-time assertion: AIRAGHelpHandler satisfies http.Handler.
var _ http.Handler = (*AIRAGHelpHandler)(nil)
