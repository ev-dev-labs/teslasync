package api

// Phase-50 / 0003 — F2 Settings UI for AI.
//
// This file mounts POST /api/v1/settings/ai/validate-config — the
// pre-flight provider validation endpoint the F2 Settings UI calls
// before saving an AI configuration. The route lives on the SETTINGS
// sub-tree, NOT on /api/v1/ai/*, for two intentional reasons:
//
//  1. ADR-015 §I6 says every /api/v1/ai/* route returns 404 when
//     ai_mode='off'. The validate endpoint must be reachable WHILE
//     the user is opting in (ai_mode='off' at the moment of the
//     pre-flight call), so it cannot live on the AI sub-tree.
//  2. Mounting on /api/v1/settings/ai/* keeps tools/aivet's invariant
//     ("every /api/v1/ai/* is wrapped by guard.Wrap") clean — a
//     parallel WrapValidating helper would create two ways to mount
//     AI routes and complicate the static analysis.
//
// The handler does no network I/O beyond DNS resolution (via
// provider.ValidateLocalCtx, which uses net.DefaultResolver). It
// never reaches out to the provider's API surface — that would
// constitute "egress in off mode" and violate ADR-015 §I4. A real
// connectivity probe is a future feature (slice F1 already ships
// /api/v1/ai/_internal/health for the post-enable case).
//
// Cloud mode validation is intentionally a no-op: cloud mode accepts
// any HTTPS URL by definition, so validating it adds no information
// the URL-input layer cannot provide. Returning success for cloud
// mode lets the SPA call this endpoint uniformly without branching
// on mode, which keeps the F2 Settings UI simple.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// validateConfigRequest is the JSON body of POST
// /api/v1/settings/ai/validate-config.
//
// The shape mirrors ProviderConfig minus the API-key (which is not
// validated here) and minus PinnedIP (which is computed by the
// validator, not supplied by the client).
type validateConfigRequest struct {
	// Mode is one of 'off' / 'local' / 'cloud'. 'off' returns
	// 400 — there is nothing to validate, and asking for it is
	// almost certainly a SPA bug.
	Mode string `json:"mode"`

	// Provider is the registered adapter name (ollama, openai, …).
	// Reserved for future use; F2 ignores it because the validator
	// is currently provider-agnostic (it just enforces RFC1918).
	Provider string `json:"provider,omitempty"`

	// BaseURL is the candidate provider endpoint. Required when
	// mode='local'. Defaults to provider.DefaultLocalBaseURL when
	// empty so a "Test Connection" click on a fresh form still
	// validates the canonical loopback.
	BaseURL string `json:"base_url,omitempty"`
}

// validateConfigResponse is the JSON body of a successful 200.
//
// PinnedIP is the IP the validator wrote into ProviderConfig.PinnedIP
// at config-save time, returned here so the SPA can show the user
// "Pinned to 127.0.0.1" feedback. CheckPinnedIP at request time will
// re-resolve and compare against this pin (DNS rebinding detector,
// R3 mitigation in slice F1).
type validateConfigResponse struct {
	OK       bool   `json:"ok"`
	Mode     string `json:"mode"`
	BaseURL  string `json:"base_url"`
	PinnedIP string `json:"pinned_ip,omitempty"`
	Note     string `json:"note,omitempty"`
}

// validateConfigReasonCode is the structured `code` value the
// validate handler hands back on a 422. The SPA matches on these
// constants (mirrored in
// `web/src/api/hooks/useAiSettings.ts::ValidateAiProviderFailure`)
// so a future translation lookup can switch on `code` rather than
// parsing the human message.
//
// We use the standard `{error, code}` body shape produced by
// `writeErrorCode` so the SPA's `ApiError` parser surfaces both
// fields without any special-case decoding — `e.message` carries
// the human prose, `e.code` carries the structured reason.
const (
	validateConfigCodeNotLocal = "not_local"
	validateConfigCodeInvalid  = "invalid"
)

// validateConfigTimeout is the upper bound on the DNS resolution +
// validator round-trip. 5s is generous enough for a stalled resolver
// to retry once but short enough that the SPA's "Test Connection"
// spinner never feels stuck.
const validateConfigTimeout = 5 * time.Second

// AISettingsValidateHandler returns the http.HandlerFunc for
// POST /api/v1/settings/ai/validate-config.
//
// The handler is constructor-style (returns a closure) for symmetry
// with the F1 newAIInternalHealthHandler and to leave a seam for a
// future test that swaps a deterministic resolver in.
func AISettingsValidateHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req validateConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		switch req.Mode {
		case provider.ModeCloud:
			// Cloud mode: nothing to validate at the URL level.
			// The SPA still calls this so its "Test Connection"
			// path is uniform; we acknowledge with OK + a note so
			// the UI can surface "no validation needed".
			writeJSON(w, http.StatusOK, validateConfigResponse{
				OK:      true,
				Mode:    req.Mode,
				BaseURL: req.BaseURL,
				Note:    "cloud mode does not require URL validation",
			})
			return

		case provider.ModeLocal:
			// Local mode: enforce RFC1918 / loopback / link-local /
			// ULA membership AND pin the resolved IP.
			baseURL := req.BaseURL
			if baseURL == "" {
				baseURL = provider.DefaultLocalBaseURL
			}
			cfg := provider.ProviderConfig{BaseURL: baseURL}
			ctx, cancel := context.WithTimeout(r.Context(), validateConfigTimeout)
			defer cancel()
			pinnedIP, err := provider.ValidateLocalCtx(ctx, cfg)
			if err != nil {
				log.Info().
					Err(err).
					Str("base_url", baseURL).
					Msg("ai settings: local validation rejected base_url")
				code := validateConfigCodeInvalid
				if errors.Is(err, provider.ErrLocalModeViolation) {
					code = validateConfigCodeNotLocal
				}
				writeErrorCode(w, http.StatusUnprocessableEntity, err.Error(), code)
				return
			}
			writeJSON(w, http.StatusOK, validateConfigResponse{
				OK:       true,
				Mode:     req.Mode,
				BaseURL:  baseURL,
				PinnedIP: pinnedIP,
			})
			return

		case provider.ModeOff, "":
			// 'off' has nothing to validate; reject with 400 so a
			// SPA bug calling this endpoint with the wrong mode
			// surfaces immediately.
			writeError(w, http.StatusBadRequest, "ai_mode must be 'local' or 'cloud' to validate")
			return

		default:
			writeError(w, http.StatusBadRequest, "ai_mode must be 'off', 'local', or 'cloud'")
			return
		}
	}
}
