package chatbot

// Chatbot responder with opt-in LLM support.
//
// ChatResponder keeps the heuristic baseline route separate from the AI-only
// dispatch path, preserving ADR-015's off-mode baseline contract.

import (
	"context"
)

// ChatResponder separates the baseline response envelope from AI-only SSE and provider concerns.
type ChatResponder interface {
	// Respond synthesises an assistant reply for the user's
	// message. The returned string is the full assistant response
	// (no streaming). An error means the handler should respond
	// with HTTP 500 — empty-string-with-nil-error is allowed and
	// is rendered to the user as a "no response" message.
	Respond(ctx context.Context, message string) (string, error)
}

// BaselineResponder wraps the existing heuristic without changing behavior,
// so off-mode tests can prove it remains independent of the AI path.
type BaselineResponder struct {
	h *ChatbotHandler
}

// NewBaselineResponder wraps the heuristic chatbot in a
// ChatResponder. h must be non-nil (constructor panics otherwise so
// the wiring bug surfaces at boot, not at first request).
func NewBaselineResponder(h *ChatbotHandler) *BaselineResponder {
	if h == nil {
		panic("chatbot: NewBaselineResponder: nil ChatbotHandler")
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

var _ ChatResponder = (*BaselineResponder)(nil)
