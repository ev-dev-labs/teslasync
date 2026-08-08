package aichatbot

// Chatbot LLM handler.
//
// POST /api/v1/ai/chatbot persists the user turn, streams the LLM
// response over SSE, and stores the completed assistant reply. ADR-015
// guard wrapping keeps the AI route hidden in off-mode, while strategy
// tool filtering, deny-all confirmation, and PolicyChatbot redaction
// bound what reaches the provider.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	chatbotmodel "github.com/ev-dev-labs/teslasync/internal/models/chatbot"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	chatbotllm "github.com/ev-dev-labs/teslasync/internal/ai/strategies/chatbot-llm"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
)

// historyLimit bounds LLM context while keeping enough recent turns for
// follow-up questions. Older messages remain in chatbot_messages for audit
// and the /chatbot/history endpoint.
const historyLimit = 16

// maxIterations bounds the dispatcher tool loop; six covers normal chat
// plus optional tool turns without allowing pathological model loops.
const maxIterations = 6

// Handler is the HTTP handler for POST /api/v1/ai/chatbot.
//
// Construction is in router.go (so the dispatcher's tool registry +
// provider registry are wired once at boot). The handler itself is
// stateless beyond its constructor inputs and is safe for concurrent
// use across requests.
type Handler struct {
	chat       *dbnotif.ChatRepo
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
	historyN   int
}

// NewHandler constructs the handler and panics on nil dependencies so
// wiring bugs fail at boot instead of the first AI request.
func NewHandler(
	chat *dbnotif.ChatRepo,
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case chat == nil:
		panic("aichatbot: NewHandler: nil ChatRepo")
	case registry == nil:
		panic("aichatbot: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aichatbot: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aichatbot: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		chat:       chat,
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
		historyN:   historyLimit,
	}
}

// request is the wire shape for POST /api/v1/ai/chatbot.
// Mirrors the existing baseline endpoint so the frontend can call
// either route without DTO drift.
type request struct {
	Message   string `json:"message"`
	SessionID string `json:"session_id"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the assistant's full reply is persisted
// after the SSE stream closes. Every error path writes a structured
// frame onto the SSE stream (when the writer has been opened) or a
// plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body request
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(body.Message) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "message is required")
		return
	}
	if body.SessionID == "" {
		body.SessionID = fmt.Sprintf("s_%d", time.Now().UnixNano())
	}

	// 2) Persist the user turn BEFORE calling the LLM. If the LLM
	// fails midway, the user's message is preserved in history so
	// they can see what they asked. Best-effort — a save failure is
	// logged but does not abort the response (matches the existing
	// /chatbot baseline's behaviour).
	userMsg := &chatbotmodel.ChatMessage{
		SessionID: body.SessionID,
		Role:      "user",
		Content:   body.Message,
	}
	if err := h.chat.SaveMessage(r.Context(), userMsg); err != nil {
		log.Warn().Err(err).Str("session_id", body.SessionID).Msg("ai chatbot: failed to persist user message")
	}

	// ChatRepo returns ASC order, which matches the dispatcher's newest-last history contract.
	rawHistory, err := h.chat.GetHistory(r.Context(), body.SessionID, h.historyN)
	if err != nil {
		log.Warn().Err(err).Str("session_id", body.SessionID).Msg("ai chatbot: failed to load history; continuing with empty context")
		rawHistory = nil
	}
	history := historyToProviderMessages(rawHistory, body.Message)

	// 4) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), chatbotllm.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai chatbot: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// An empty subject is the open-mode value recorded as anonymous.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, chatbotllm.FeatureID)

	// 6) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a
	// child ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(chatbotllm.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai chatbot: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 7) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, chatbotllm.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai chatbot: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 8) Build the dispatcher with a deny-all confirm hook. The
	// chatbot strategy declares only read-only tools, so the
	// confirm hook never fires — but defence-in-depth: if a future
	// strategy edit adds a mutating tool by mistake, the dispatcher
	// will REJECT it instead of silently mutating.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Capture streamed deltas so the completed assistant reply can be persisted.
	rec := &recordingStreamWriter{inner: sseW}

	// 10) Run the dispatcher. It emits a done frame only for a complete
	// response and an error frame for failed or truncated streams.
	in := strategy.StrategyInput{
		LastMessage: body.Message,
		History:     history,
	}
	if runErr := d.Run(ctx, h.strategy, in, rec); runErr != nil {
		// Errors are already surfaced on the SSE wire. Do not persist partial
		// output into future conversation history as if it were complete.
		log.Error().Err(runErr).Str("session_id", body.SessionID).Msg("ai chatbot: dispatcher returned error")
		return
	}
	if !rec.succeeded() {
		// Structured limit events are terminal errors on the wire but are
		// intentionally handled by the dispatcher without a Go error.
		return
	}

	// 11) Persist the assistant turn (best-effort, like the user
	// turn). An empty string is allowed: it surfaces in /chatbot/history
	// as evidence that a turn happened but produced no text (e.g.,
	// the conversation hit max-iterations).
	assistantText := strings.TrimSpace(rec.text())
	if assistantText != "" {
		assistantMsg := &chatbotmodel.ChatMessage{
			SessionID: body.SessionID,
			Role:      "assistant",
			Content:   assistantText,
		}
		if perr := h.chat.SaveMessage(context.Background(), assistantMsg); perr != nil {
			log.Warn().Err(perr).Str("session_id", body.SessionID).Msg("ai chatbot: failed to persist assistant message")
		}
	}
}

// historyToProviderMessages converts persisted ChatMessage rows into
// provider.Message entries the dispatcher can replay. The most recent
// "user" entry that matches the just-decoded body.Message is filtered
// out (we already passed it as StrategyInput.LastMessage and the
// dispatcher seeds it as the final turn — including it here would
// double the user's last message).
//
// Order is preserved (history was loaded ASC; provider.Message slices
// are NEWEST LAST). Nil/empty input returns nil so the dispatcher
// sees an explicit empty history.
func historyToProviderMessages(rows []*chatbotmodel.ChatMessage, currentUserMessage string) []provider.Message {
	if len(rows) == 0 {
		return nil
	}
	out := make([]provider.Message, 0, len(rows))
	for i, m := range rows {
		// Avoid replaying the current user turn twice.
		if i == len(rows)-1 && m.Role == "user" && m.Content == currentUserMessage {
			continue
		}
		out = append(out, provider.Message{
			Role:    m.Role,
			Content: m.Content,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// denyAllConfirm is the dispatcher's user-confirm hook. The chatbot
// strategy declares zero mutating tools, so this is never called in
// practice — but it's wired anyway as defence-in-depth: if a future
// edit accidentally adds a mutating tool to the chatbot's allowlist,
// the dispatcher will REJECT it instead of silently mutating fleet
// state. Errors are not returned (we want a clean Denied decision so
// the dispatcher surfaces a "user cancelled" message).
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// recordingStreamWriter is a thin tee around dispatch.StreamWriter
// that captures every WriteDelta into an internal buffer while
// forwarding all calls to the inner writer verbatim. The captured
// text is the assistant's full reply, used for persistence after the
// dispatcher returns.
//
// The dispatcher contract is single-producer-single-consumer per Run
// invocation, so the buffer needs no synchronisation.
type recordingStreamWriter struct {
	inner     *stream.Writer
	buf       strings.Builder
	completed bool
	failed    bool
}

// WriteDelta records the fragment and forwards writer errors to the dispatcher.
func (r *recordingStreamWriter) WriteDelta(s string) error {
	r.buf.WriteString(s)
	return r.inner.WriteDelta(s)
}

// WriteToolCall forwards. Tool-call announcements are not part of
// the assistant's natural-language reply, so they are not captured
// in the buffer.
func (r *recordingStreamWriter) WriteToolCall(call provider.ToolCall) error {
	return r.inner.WriteToolCall(call)
}

func (r *recordingStreamWriter) WriteToolResult(name string, result json.RawMessage) error {
	return r.inner.WriteToolResult(name, result)
}

func (r *recordingStreamWriter) WriteToolError(name string, err error) error {
	return r.inner.WriteToolError(name, err)
}

// WriteDone forwards. The dispatcher is contractually allowed to
// call WriteDone exactly once; the inner stream.Writer enforces
// single-call semantics via a sync.Once.
func (r *recordingStreamWriter) WriteDone() error {
	err := r.inner.WriteDone()
	if err == nil && !r.failed {
		r.completed = true
	}
	return err
}

func (r *recordingStreamWriter) WriteDoneFull(finishReason string, usageIn, usageOut int) error {
	err := r.inner.WriteDoneFull(finishReason, usageIn, usageOut)
	if err == nil && !r.failed {
		r.completed = true
	}
	return err
}

func (r *recordingStreamWriter) WriteError(err error) error {
	r.failed = true
	r.completed = false
	return r.inner.WriteError(err)
}

// EmitLimitError satisfies the optional dispatch.LimitErrorEmitter
// interface — the dispatcher type-asserts on this when the F9
// rate-limit/cost-cap chain rejects the call. Forwarding to the
// underlying SSE writer's WriteLimitError preserves the structured
// payload the frontend banner reads.
func (r *recordingStreamWriter) EmitLimitError(message, reason string, retryAfterS int, bannerLevel string, baselineAvailable bool) error {
	r.failed = true
	r.completed = false
	return r.inner.WriteLimitError(message, stream.LimitDecisionPayload{
		Reason:            reason,
		RetryAfterS:       retryAfterS,
		BannerLevel:       bannerLevel,
		BaselineAvailable: baselineAvailable,
	})
}

// text returns the captured assistant text. Safe to call after the
// dispatcher has returned (the dispatcher's defer-WriteDone has
// flushed any pending delta).
func (r *recordingStreamWriter) text() string {
	return r.buf.String()
}

func (r *recordingStreamWriter) succeeded() bool {
	return r.completed && !r.failed
}

// Compile-time assertions: recordingStreamWriter satisfies the
// dispatcher's StreamWriter port + the optional LimitErrorEmitter.
var (
	_ dispatch.StreamWriter      = (*recordingStreamWriter)(nil)
	_ dispatch.CompletionWriter  = (*recordingStreamWriter)(nil)
	_ dispatch.ErrorEmitter      = (*recordingStreamWriter)(nil)
	_ dispatch.LimitErrorEmitter = (*recordingStreamWriter)(nil)
)
