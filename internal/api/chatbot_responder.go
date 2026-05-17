package api

// Phase-50 / 0011 — U1 Chatbot LLM upgrade.
//
// chatbot_responder.go declares the small ChatResponder seam that
// the Phase-50 split between the unconditional baseline route
// (POST /chatbot, heuristic) and the AI-only route (POST
// /api/v1/ai/chatbot, LLM via dispatch.Dispatcher) is built on.
//
// Why an interface and not a direct method call?
//
// ADR-015 §I3 ("baseline intact") demands that the heuristic chatbot
// keeps working byte-identically when ai_mode='off'. The cleanest way
// to express that contract in Go is:
//
//   - Keep ChatbotHandler.processQuery (the heuristic) UNCHANGED.
//     Wrap it in a ChatResponder with a single Respond method.
//   - Wrap the dispatch.Dispatcher (the LLM path) in a separate
//     responder living next to the AI handler.
//   - The off-mode integration test asserts that the AI route returns
//     404 AND that the baseline route still produces a response —
//     proving the two paths are decoupled.
//
// Selection happens at construction time, NOT inside business logic
// (per the prompt's "Baseline coexistence" section): the baseline
// route always uses BaselineResponder; the AI route always uses the
// LLM responder. There is no per-request branch inside Respond.

import (
	"context"
)

// ChatResponder is the Phase-50 single-method seam between the chatbot
// HTTP handler(s) and the underlying response-generation strategy.
//
// Implementations:
//
//   - [BaselineResponder] — wraps [ChatbotHandler.processQuery] (the
//     existing heuristic substring matcher). Used by the unconditional
//     POST /chatbot route. Return value is the assistant message text.
//   - The AI-only route streams via dispatch.Dispatcher directly to an
//     SSE writer; it does not implement ChatResponder because the
//     streaming surface is fundamentally different from the synchronous
//     baseline. Both routes nonetheless conform to the same lifecycle:
//     decode → persist user msg → respond → persist assistant msg.
//
// The interface intentionally takes only ctx + the user's message and
// returns plain text + error. Per-request session state (history, ids)
// is the HTTP handler's job, not the responder's — that keeps every
// implementation pure-functional and easy to test.
type ChatResponder interface {
	// Respond synthesises an assistant reply for the user's
	// message. The returned string is the full assistant response
	// (no streaming). An error means the handler should respond
	// with HTTP 500 — empty-string-with-nil-error is allowed and
	// is rendered to the user as a "no response" message.
	Respond(ctx context.Context, message string) (string, error)
}

// BaselineResponder is the Phase-50 wrapper around the existing
// heuristic chatbot. It exists purely so the off-mode test can prove
// the heuristic is reachable independently of the dispatch.Dispatcher
// path — the wrapper does not introduce new behaviour.
//
// The method body is a single delegation; the type is one field. The
// surface is small on purpose: the heuristic must keep working
// byte-identically across this slice (ADR-015 §I3) so any "improvement"
// here is a regression risk.
type BaselineResponder struct {
	h *ChatbotHandler
}

// NewBaselineResponder wraps the heuristic chatbot in a
// ChatResponder. h must be non-nil (constructor panics otherwise so
// the wiring bug surfaces at boot, not at first request).
func NewBaselineResponder(h *ChatbotHandler) *BaselineResponder {
	if h == nil {
		panic("api: NewBaselineResponder: nil ChatbotHandler")
	}
	return &BaselineResponder{h: h}
}

// Respond implements [ChatResponder] by delegating to the existing
// heuristic [ChatbotHandler.processQuery]. The heuristic itself never
// returns an error (it falls back to a canned "I don't know" string),
// so this method always returns nil for err.
//
// Future maintenance note: if processQuery is ever changed to return
// an error, propagate it here verbatim — do not swallow.
func (r *BaselineResponder) Respond(ctx context.Context, message string) (string, error) {
	return r.h.processQuery(ctx, message), nil
}

// Compile-time assertion: BaselineResponder satisfies ChatResponder.
var _ ChatResponder = (*BaselineResponder)(nil)
