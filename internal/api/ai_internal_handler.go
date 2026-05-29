package api

// Phase-50 / 0002 — F1 Provider Abstraction.
//
// Ops-only provider diagnostics are gated by ADR-015's AI guard,
// RequireSudo, and the registry's disabled-mode checks. The endpoint
// currently serves curl-based ops checks and later backs the Settings UI test.

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// newAIInternalHealthHandler serves GET /api/v1/ai/_internal/health.
// The registry is captured for in-memory tests; guard-disabled requests should
// never reach this handler, and registry failures surface as 503 for ops.
func newAIInternalHealthHandler(registry *provider.Registry) http.HandlerFunc {
	const featureID = "ai-provider-health"
	return func(w http.ResponseWriter, r *http.Request) {
		info, err := registry.HealthSnapshot(r.Context(), featureID)
		if err != nil {
			switch {
			case errors.Is(err, provider.ErrProviderDisabled):
				// Defense in depth if the registry sees fresher mode state than the guard.
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
