package api

// Phase-50 / 0001 — F0 AI-Off Contract.
// Phase-50 / 0011 — U1 wires the real chatbot LLM handler in place
// of the F0 stub.
//
// This file mounts the canonical /api/v1/ai/* routes.
//
// Why this exists:
// The AI-off contract (ADR-015 §I6) is "off mode handlers return 404".
// Asserting that contract requires at least one route to *be* mounted —
// otherwise the 404 the curl probe sees is the chi router's
// default-no-match 404, which proves nothing about the guard. Mounting
// the chatbot-llm route (with the real handler now that U1 has shipped)
// gives the off-mode test, the integration log curl, and the 9999
// final-gate Playwright walk a concrete handler whose 404 is *guaranteed
// by the guard* and not by the absence of a registration.
//
// The real handler (Phase-50 / U1) only runs when a user has explicitly:
//   1. Set ai_mode to "local" or "cloud" in Settings, AND
//   2. Toggled the chatbot-llm feature flag on.
// Otherwise the guard returns 404 BEFORE the handler is reached.

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/go-chi/chi/v5"
)

// mountAIRoutes registers every /api/v1/ai/* route through the guard.
// Called from inside the /api/v1 subroute in NewRouter so the standard
// auth, logging, rate-limit, and tracing middleware all apply before
// the per-request feature gate fires.
//
// Adding a new AI route MUST go through this function so tools/aivet
// can statically prove every AI route is wrapped by guard.Wrap.
//
// Parameters:
//   - r          : the parent chi router (the /api/v1 subroute).
//   - g          : the AI feature guard (mode + per-feature toggle).
//   - registry   : the provider registry (Phase-50 / F1, slice 0002).
//   - sudoMW     : RequireSudo middleware factory baked with the live
//                  sudoStore + sudoCfg. Wrapped around ops-only routes
//                  like /_internal/health so an attacker who somehow
//                  opens the feature toggle still needs a fresh sudo
//                  token to reach the diagnostic.
//   - aiChatbot  : the real LLM-backed handler from
//                  internal/api/ai_chatbot_handler.go (Phase-50 / U1).
//                  May be nil during early bring-up; nil falls back to
//                  the F0 501 stub so the off-mode 404 invariant still
//                  holds.
//   - aiDigest   : the real LLM-backed handler for the weekly digest
//                  narration (Phase-50 / U2). May be nil during early
//                  bring-up; nil falls back to the same 501 stub.
func mountAIRoutes(
	r chi.Router,
	g *guard.Guard,
	registry *provider.Registry,
	sudoMW func(http.Handler) http.Handler,
	aiChatbot *AIChatbotHandler,
	aiDigest *AIDigestHandler,
) {
	r.Route("/ai", func(r chi.Router) {
		// chatbot-llm (Phase-50 / U1, slice 0011 wires the real
		// handler). Earlier slices used a 501 stub; the stub is
		// retained for nil-handler defensive wiring so a misordered
		// boot still yields a non-nil http.Handler whose 404 in
		// off mode is provable by the guard.
		var chatbotHandler http.HandlerFunc = aiChatbotStubHandler
		if aiChatbot != nil {
			chatbotHandler = aiChatbot.ServeHTTP
		}
		r.Post("/chatbot", g.Wrap("chatbot-llm", chatbotHandler))

		// digest-narration (Phase-50 / U2, slice 0012). Same
		// stub-fallback pattern as chatbot — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode.
		var digestHandler http.HandlerFunc = aiDigestStubHandler
		if aiDigest != nil {
			digestHandler = aiDigest.ServeHTTP
		}
		r.Post("/digests/weekly/narrate", g.Wrap("digest-narration", digestHandler))

		// ai-provider-health (Phase-50 / F1, slice 0002).
		// Ops-only diagnostic. Triple-gated:
		//   guard.Wrap (mode + feature toggle) → RequireSudo → handler.
		// Returns 404 in off mode (ADR-015 §I6 + §I9 — provider
		// info MUST NOT leak when AI is disabled).
		r.With(sudoMW).Get("/_internal/health",
			g.Wrap("ai-provider-health", newAIInternalHealthHandler(registry)))
	})
}

// aiChatbotStubHandler is the legacy F0 fall-back. The U1 production
// path uses the real *AIChatbotHandler; the stub remains so a
// defensive nil-handler wiring still yields a meaningful 501 instead
// of panicking. Ops never see this in normal operation.
func aiChatbotStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai chatbot is not yet implemented")
}

// aiDigestStubHandler mirrors aiChatbotStubHandler for the U2 slice.
// Reachable only when AIDigestHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiDigestStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai digest narration is not yet implemented")
}
