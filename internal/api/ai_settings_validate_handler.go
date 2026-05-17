package api

// Phase-50 / 0003 — F2 Settings UI for AI.
// Phase-50 / Azure adapter — extended for cloud-probe validation.
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
// LOCAL mode does no network I/O beyond DNS resolution (via
// provider.ValidateLocalCtx, which uses net.DefaultResolver). It
// never reaches out to a provider's API surface — that would
// constitute "egress in off mode" and violate ADR-015 §I4.
//
// CLOUD mode, by contrast, performs a real one-shot probe against the
// supplied (or saved) API endpoint with a 1-token chat completion. The
// probe is the only reliable way to confirm that base_url + api_key +
// flavor + deployment + api_version all line up — purely-syntactic
// validation cannot tell a typo'd deployment name from a valid one.
// The probe is allowed because the user has explicitly opted in to a
// cloud provider at the moment of the click; ADR-015 §I4 only forbids
// egress while ai_mode='off' and this handler is gated on the SPA
// supplying mode='cloud' explicitly.
//
// API-key handling: the request body MAY include `api_key`. If empty,
// the handler falls back to the saved value in
// settings.ai_provider_config[provider].api_key — this keeps the UX
// reasonable when the user is editing a saved config and doesn't want
// to re-type the secret. The probe only ever sends the key to the
// configured upstream over TLS; nothing is logged.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// validateConfigRequest is the JSON body of POST
// /api/v1/settings/ai/validate-config.
//
// For mode='local' only Mode + BaseURL are consulted (the validator
// is provider-agnostic and just enforces RFC1918). For mode='cloud'
// the full ProviderConfig surface is accepted so the handler can
// reconstruct an Adapter and run a one-shot probe against the user-
// supplied endpoint.
type validateConfigRequest struct {
	// Mode is one of 'off' / 'local' / 'cloud'. 'off' returns
	// 400 — there is nothing to validate, and asking for it is
	// almost certainly a SPA bug.
	Mode string `json:"mode"`

	// Provider is the registered adapter name (ollama, openai,
	// anthropic, azure, …). Required when mode='cloud'; falls back
	// to the saved settings.ai_provider_config.default key when
	// empty so the SPA can validate without re-stating the
	// selection on every keystroke.
	Provider string `json:"provider,omitempty"`

	// BaseURL is the candidate provider endpoint. Required when
	// mode='local'. For mode='cloud' it falls back to the saved
	// per-provider entry when empty (so editing the deployment
	// name doesn't force the user to re-type the URL).
	BaseURL string `json:"base_url,omitempty"`

	// Cloud-only fields. All optional with empty-falls-back-to-
	// saved semantics. APIKey in particular falls back to the
	// previously-saved key so the user can validate after editing
	// a non-secret field without re-typing the secret.
	APIKey              string `json:"api_key,omitempty"`
	Model               string `json:"model,omitempty"`
	APIVersion          string `json:"api_version,omitempty"`
	Flavor              string `json:"flavor,omitempty"`
	Deployment          string `json:"deployment,omitempty"`
	EmbeddingModel      string `json:"embedding_model,omitempty"`
	EmbeddingDeployment string `json:"embedding_deployment,omitempty"`
}

// validateConfigResponse is the JSON body of a successful 200.
//
// PinnedIP is the IP the local validator wrote into ProviderConfig
// at config-save time. ProbedModel echoes the model the cloud probe
// actually exercised so the SPA can show the user "OK — gpt-4o
// reachable" disambiguation when the deployment name differs from
// the model identifier.
type validateConfigResponse struct {
	OK          bool   `json:"ok"`
	Mode        string `json:"mode"`
	BaseURL     string `json:"base_url"`
	PinnedIP    string `json:"pinned_ip,omitempty"`
	ProbedModel string `json:"probed_model,omitempty"`
	Note        string `json:"note,omitempty"`
}

// validateConfigReasonCode is the structured `code` value the
// validate handler hands back on a 422 / 400. The SPA matches on
// these constants (mirrored in
// `web/src/api/hooks/useAiSettings.ts::ValidateAiProviderReason`)
// so a future translation lookup can switch on `code` rather than
// parsing the human message.
const (
	validateConfigCodeNotLocal         = "not_local"
	validateConfigCodeInvalid          = "invalid"
	validateConfigCodeUnknownProvider  = "unknown_provider"
	validateConfigCodeMissingAPIKey    = "missing_api_key"
	validateConfigCodeMissingBaseURL   = "missing_base_url"
	validateConfigCodeMissingDeployment = "missing_deployment"
	validateConfigCodeUnauthorized     = "unauthorized"
	validateConfigCodeNotFound         = "not_found"
	validateConfigCodeUpstreamError    = "upstream_error"
	validateConfigCodeTimeout          = "timeout"
)

// validateConfigLocalTimeout bounds DNS resolution for the local
// validator. 5s is generous enough for a stalled resolver to retry
// once but short enough that the SPA's spinner never feels stuck.
const validateConfigLocalTimeout = 5 * time.Second

// validateConfigCloudTimeout bounds the cloud probe. Cloud providers
// can be slow on first call (cold deployment, regional routing); 30s
// trades spinner duration for false-negative reduction. The SPA
// surfaces "validating…" so the user knows work is in flight.
const validateConfigCloudTimeout = 30 * time.Second

// httpStatusInErrorRe extracts an HTTP status code from a wrapped
// adapter error message (the adapters embed the status in the wrap
// text, e.g. "openai chat status 401: Unauthorized"). We classify
// based on this so a 401 surfaces as "unauthorized" rather than
// "invalid" in the SPA.
var httpStatusInErrorRe = regexp.MustCompile(`status (\d{3})`)

// AISettingsValidateHandler returns the http.HandlerFunc for
// POST /api/v1/settings/ai/validate-config.
//
// registry must be non-nil — required for cloud-mode probes. settings
// must be non-nil — required to read the saved api_key fallback.
// Passing nil for either panics at boot, which is the right failure
// mode (a misconfigured router would otherwise silently 500 every
// validate call).
func AISettingsValidateHandler(registry *provider.Registry, settings provider.SettingsReader) http.HandlerFunc {
	if registry == nil {
		panic("api: AISettingsValidateHandler called with nil registry")
	}
	if settings == nil {
		panic("api: AISettingsValidateHandler called with nil settings")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var req validateConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		switch req.Mode {
		case provider.ModeCloud:
			handleValidateCloud(w, r, registry, settings, req)
			return

		case provider.ModeLocal:
			handleValidateLocal(w, r, req)
			return

		case provider.ModeOff, "":
			writeError(w, http.StatusBadRequest, "ai_mode must be 'local' or 'cloud' to validate")
			return

		default:
			writeError(w, http.StatusBadRequest, "ai_mode must be 'off', 'local', or 'cloud'")
			return
		}
	}
}

// handleValidateLocal enforces the RFC1918 / loopback / link-local /
// ULA membership invariant on the supplied base_url and pins the
// resolved IP so the runtime can detect DNS rebinding (R3 mitigation).
func handleValidateLocal(w http.ResponseWriter, r *http.Request, req validateConfigRequest) {
	baseURL := req.BaseURL
	if baseURL == "" {
		baseURL = provider.DefaultLocalBaseURL
	}
	cfg := provider.ProviderConfig{BaseURL: baseURL}
	ctx, cancel := context.WithTimeout(r.Context(), validateConfigLocalTimeout)
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
		Mode:     provider.ModeLocal,
		BaseURL:  baseURL,
		PinnedIP: pinnedIP,
	})
}

// handleValidateCloud builds a temporary adapter from (request,
// fallback-to-saved) and runs a one-shot Chat probe with MaxTokens=1.
// Errors are classified into stable codes the SPA can render as
// human messages without re-parsing the upstream error text.
func handleValidateCloud(
	w http.ResponseWriter,
	r *http.Request,
	registry *provider.Registry,
	settings provider.SettingsReader,
	req validateConfigRequest,
) {
	ctx, cancel := context.WithTimeout(r.Context(), validateConfigCloudTimeout)
	defer cancel()

	// Read saved settings ONCE up front so api_key / base_url /
	// model can fall back to the persisted values when the request
	// omits them. A read failure is non-fatal — we still try to
	// probe with whatever the request alone supplies, and the
	// builder will reject if required fields are still empty.
	rawCfg, _ := settings.AIProviderConfig(ctx)

	// Resolve provider name: explicit > saved default > "openai"
	// fallback. The fallback exists so a fresh install with no
	// saved config can still validate the canonical cloud setup.
	name := strings.TrimSpace(req.Provider)
	if name == "" {
		view := provider.SettingsView{Mode: provider.ModeCloud, ProviderConfig: rawCfg}
		name = provider.ResolveProviderName(view, "")
	}
	if name == "" {
		writeErrorCode(w, http.StatusBadRequest,
			"provider name is required for cloud validation",
			validateConfigCodeUnknownProvider)
		return
	}

	// Pull saved entry so we can fall back per-field. Errors here
	// just mean "no saved entry yet" which is fine for first-time
	// validation; we proceed with whatever the request supplies.
	savedCfg, _ := provider.ParseProviderConfig(rawCfg, name)

	cfg := provider.ProviderConfig{
		BaseURL:             firstNonEmpty(req.BaseURL, savedCfg.BaseURL),
		Model:               firstNonEmpty(req.Model, savedCfg.Model),
		EmbeddingModel:      firstNonEmpty(req.EmbeddingModel, savedCfg.EmbeddingModel),
		APIKey:              firstNonEmpty(req.APIKey, savedCfg.APIKey),
		APIVersion:          firstNonEmpty(req.APIVersion, savedCfg.APIVersion),
		Flavor:              firstNonEmpty(req.Flavor, savedCfg.Flavor),
		Deployment:          firstNonEmpty(req.Deployment, savedCfg.Deployment),
		EmbeddingDeployment: firstNonEmpty(req.EmbeddingDeployment, savedCfg.EmbeddingDeployment),
	}

	// Cheap pre-flight checks so the SPA can render a precise
	// "you forgot the API key" message instead of an opaque
	// adapter error. The order matters: api_key is the most
	// likely missing field, then base_url for Azure, then
	// deployment for Azure OpenAI Service flavor.
	if cfg.APIKey == "" {
		writeErrorCode(w, http.StatusUnprocessableEntity,
			"api key is required for cloud validation",
			validateConfigCodeMissingAPIKey)
		return
	}
	if name == provider.NameAzure && cfg.BaseURL == "" {
		writeErrorCode(w, http.StatusUnprocessableEntity,
			"resource endpoint URL is required for Azure",
			validateConfigCodeMissingBaseURL)
		return
	}
	if name == provider.NameAzure {
		flavor := cfg.Flavor
		if flavor == "" {
			flavor = provider.DefaultAzureFlavor
		}
		if flavor == provider.AzureFlavorOpenAI &&
			cfg.Deployment == "" && cfg.Model == "" {
			writeErrorCode(w, http.StatusUnprocessableEntity,
				"deployment name (or model) is required for Azure OpenAI Service",
				validateConfigCodeMissingDeployment)
			return
		}
	}

	prov, err := registry.ProviderForName(name, cfg)
	if err != nil {
		log.Info().
			Err(err).
			Str("provider", name).
			Msg("ai settings: cloud probe build failed")
		code := validateConfigCodeInvalid
		if errors.Is(err, provider.ErrUnknownProvider) {
			code = validateConfigCodeUnknownProvider
		}
		writeErrorCode(w, http.StatusUnprocessableEntity, err.Error(), code)
		return
	}

	// One-shot probe. MaxTokens=1 keeps cost negligible (~$0.0001
	// for gpt-4o-mini). "ping" is short enough that the model
	// almost always emits a single token without the conversation
	// derailing into long-form output.
	probeReq := provider.ChatRequest{
		Model: cfg.Model,
		Messages: []provider.Message{
			{Role: "user", Content: "ping"},
		},
		MaxTokens:   1,
		Temperature: 0,
	}
	resp, err := prov.Chat(ctx, probeReq)
	if err != nil {
		code, msg := classifyCloudProbeError(ctx, err)
		log.Info().
			Err(err).
			Str("provider", name).
			Str("code", code).
			Msg("ai settings: cloud probe failed")
		writeErrorCode(w, http.StatusUnprocessableEntity, msg, code)
		return
	}

	probedModel := cfg.Model
	if resp != nil && resp.Message.Content != "" {
		// Some providers echo the model identifier in the response;
		// we keep the configured one for stability since the
		// response shape is provider-specific.
		_ = resp
	}

	writeJSON(w, http.StatusOK, validateConfigResponse{
		OK:          true,
		Mode:        provider.ModeCloud,
		BaseURL:     cfg.BaseURL,
		ProbedModel: probedModel,
		Note:        "cloud probe succeeded",
	})
}

// classifyCloudProbeError maps an adapter error into one of the
// stable validateConfigCode* values. Inspects (1) the wrapped
// sentinel chain (errors.Is), (2) the embedded HTTP status from the
// adapter's error message, (3) ctx cancellation, in that order.
func classifyCloudProbeError(ctx context.Context, err error) (code, message string) {
	if errors.Is(err, provider.ErrCapabilityNotSupported) {
		return validateConfigCodeInvalid, err.Error()
	}
	if ctx.Err() == context.DeadlineExceeded {
		return validateConfigCodeTimeout,
			"cloud probe timed out — the provider did not respond within 30s"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return validateConfigCodeTimeout,
			"cloud probe timed out — the provider did not respond within 30s"
	}

	msg := err.Error()
	if m := httpStatusInErrorRe.FindStringSubmatch(msg); len(m) == 2 {
		switch m[1] {
		case "401", "403":
			return validateConfigCodeUnauthorized,
				"the API key was rejected by the provider (401/403)"
		case "404":
			return validateConfigCodeNotFound,
				"the provider returned 404 — check the deployment name and endpoint URL"
		case "429":
			return validateConfigCodeUpstreamError,
				"the provider rate-limited the probe (429) — retry in a moment"
		}
		if len(m[1]) == 3 && m[1][0] == '5' {
			return validateConfigCodeUpstreamError,
				"the provider returned a server error (" + m[1] + ")"
		}
	}

	// Fallback. The adapter wraps transport-level failures in
	// ErrUpstream — we surface them as upstream_error so the SPA
	// can distinguish "your config is wrong" (invalid) from "the
	// network or provider is down" (upstream_error).
	if errors.Is(err, provider.ErrUpstream) {
		return validateConfigCodeUpstreamError, msg
	}
	return validateConfigCodeInvalid, msg
}

// firstNonEmpty is defined in feedback_handler.go (same package)
// and reused here so we don't duplicate the trivial helper.
