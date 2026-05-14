package api

// Phase-50 / 0001 — F0 AI-Off Contract.
//
// This file mounts the canonical /api/v1/ai/* routes for slice F0.
//
// Why this exists in slice F0:
// The AI-off contract (ADR-015 §I6) is "off mode handlers return 404".
// Asserting that contract requires at least one route to *be* mounted —
// otherwise the 404 the curl probe sees is the chi router's
// default-no-match 404, which proves nothing about the guard. Mounting
// the chatbot-llm seed route now (with a stub handler) gives the
// off-mode test, the integration log curl, and the 9999 final-gate
// Playwright walk a concrete handler whose 404 is *guaranteed by the
// guard* and not by the absence of a registration.
//
// The stub handler returns 501 Not Implemented when reached. That
// only happens after a user has explicitly:
//   1. Set ai_mode to "local" or "cloud" in Settings, AND
//   2. Toggled the chatbot-llm feature flag on.
// Slice U1 (0011) replaces the stub with the real LLM-backed handler.

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/go-chi/chi/v5"
)

// mountAIRoutes registers every /api/v1/ai/* route through the guard.
// Called from inside the /api/v1 subroute in NewRouter so the standard
// auth, logging, rate-limit, and tracing middleware all apply before
// the per-request feature gate fires.
//
// Adding a new AI route MUST go through this function so tools/aivet
// can statically prove every AI route is wrapped by guard.Wrap.
func mountAIRoutes(r chi.Router, g *guard.Guard) {
	r.Route("/ai", func(r chi.Router) {
		// chatbot-llm (Phase-50 / U1, slice 0011 wires the real
		// handler). The stub below exists so the AI-off contract
		// has a concrete /api/v1/ai/chatbot to assert 404 against
		// in slice F0's verification.
		r.Post("/chatbot", g.Wrap("chatbot-llm", aiChatbotStubHandler))
	})
}

// aiChatbotStubHandler is a deliberately featureless 501 stub. It is
// reachable only when the guard is fully open (ai_mode != "off" AND
// chatbot-llm feature flag = true). Slice U1 replaces it with the
// real LLM-backed implementation; until then, the stub keeps the
// route concrete so the off-mode 404 invariant is verifiable.
func aiChatbotStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai chatbot is not yet implemented (Phase-50 / U1, slice 0011)")
}
