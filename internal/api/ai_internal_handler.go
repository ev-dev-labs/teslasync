package api

// Phase-50 / 0002 — F1 Provider Abstraction.
//
// This file mounts the ops-only diagnostic endpoint that reports the
// currently-active AI provider's name and capabilities. The endpoint
// is triple-gated:
//
//   1. mountAIRoutes wraps it with guard.Wrap("ai-provider-health", …)
//      so the standard ADR-015 §I6 + §I7 contract applies — 404 when
//      ai_mode='off' OR the per-feature toggle is off.
//   2. RequireSudo(sudoStore, sudoCfg) wraps the wrap so a logged-in
//      user must have a fresh sudo token before the handler runs.
//   3. The handler itself re-checks the registry, which independently
//      enforces ADR-015 §I9 by returning ErrProviderDisabled in off
//      mode (defence in depth — even a guard bypass cannot leak
//      provider/capability info).
//
// The endpoint has no frontend; ops fetches it with curl from inside
// the cluster. Slice F2 (Settings UI) replaces the curl with an
// admin-panel "Test connection" button that hits the same route.

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// newAIInternalHealthHandler returns the http.HandlerFunc for
// GET /api/v1/ai/_internal/health. Receives the registry through a
// closure so the handler is testable against an in-memory fake.
//
// On the happy path the response shape is:
//
//	{
//	  "mode":         "local",
//	  "name":         "ollama",
//	  "capabilities": {"tools": true, "streaming": true,
//	                    "embeddings": true, "max_context": 8192}
//	}
//
// On feature/mode disabled the guard returns 404 upstream and this
// handler is never reached. On any registry-internal failure the
// handler returns 503 with a structured error so ops sees the cause
// without exposing internal call sites.
func newAIInternalHealthHandler(registry *provider.Registry) http.HandlerFunc {
	const featureID = "ai-provider-health"
	return func(w http.ResponseWriter, r *http.Request) {
		info, err := registry.HealthSnapshot(r.Context(), featureID)
		if err != nil {
			switch {
			case errors.Is(err, provider.ErrProviderDisabled):
				// Should be caught by the guard upstream — defence
				// in depth keeps the response 404 in case the
				// registry sees a fresher mode value.
				http.NotFound(w, r)
				return
			case errors.Is(err, provider.ErrFeatureDisabled):
				http.NotFound(w, r)
				return
			case errors.Is(err, provider.ErrUnknownProvider),
				errors.Is(err, provider.ErrMissingConfig):
				writeError(w, http.StatusServiceUnavailable, err.Error())
				return
			default:
				writeError(w, http.StatusServiceUnavailable, "ai provider health snapshot failed")
				return
			}
		}
		writeJSON(w, http.StatusOK, info)
	}
}
