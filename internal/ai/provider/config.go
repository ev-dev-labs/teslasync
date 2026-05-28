package provider

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Provider name constants. Adapter packages use the same string for
// their [Provider.Name] return so registry keys, log lines, and the
// settings UI never drift.
const (
	NameOllama    = "ollama"
	NameOpenAI    = "openai"
	NameAnthropic = "anthropic"
	NameAzure     = "azure"
	NameMock      = "mock"
)

// PD1 / PD2 / PD3 — provisional defaults. Surfaced in the F1 slice log
// under === PROVISIONAL DEFAULTS === for owner ack. If the owner objects
// the change applies here (single source of truth) and propagates DRY
// to the Settings UI (F2), the embeddings worker (F7), and any feature
// that does not override the default.
const (
	// DefaultLocalBaseURL is the canonical Ollama loopback endpoint.
	// Honours the ADR-015 local-mode contract by being on 127.0.0.1.
	DefaultLocalBaseURL = "http://localhost:11434"

	// DefaultLocalModel is PD1 — a llama3.1 8B instruct quant that
	// fits in ~6 GB of RAM and runs responsively on consumer GPUs.
	DefaultLocalModel = "llama3.1:8b-instruct-q4_K_M"

	// DefaultLocalEmbeddingModel is PD3 (local half) — small, dense,
	// 768-dim embeddings used by F7 RAG ingestion.
	DefaultLocalEmbeddingModel = "nomic-embed-text"

	// DefaultCloudBaseURL is PD2 — the OpenAI-compatible API surface.
	// vLLM / LiteLLM / Together / Groq all expose the same routes, so
	// "cloud" mode talks one wire format whatever the destination.
	DefaultCloudBaseURL = "https://api.openai.com"

	// DefaultCloudModel is PD2 — a small, low-cost OpenAI model that
	// supports tool use + JSON mode. Users can override per feature.
	DefaultCloudModel = "gpt-4o-mini"

	// DefaultCloudEmbeddingModel is PD3 (cloud half).
	DefaultCloudEmbeddingModel = "text-embedding-3-small"

	// DefaultAzureAPIVersion is the Azure API version the adapter
	// sends when the user has not pinned one in settings. Azure
	// exposes versioned APIs separately from the underlying model
	// — picking a stable, GA-aligned version here keeps the adapter
	// working without per-deploy edits.
	DefaultAzureAPIVersion = "2024-10-21"
)

// Azure flavor literals — selects the Azure inference surface the
// adapter targets. AzureFlavorOpenAI keeps the Azure OpenAI Service
// routing (deployment-name in URL, no model in body); AzureFlavorFoundry
// uses the modern Azure AI Inference / Foundry API (multi-vendor,
// model-in-body routing).
const (
	AzureFlavorOpenAI  = "openai"
	AzureFlavorFoundry = "foundry"
	DefaultAzureFlavor = AzureFlavorOpenAI
)

// AI mode literals. Mirrors the validated set in
// internal/api/settings_handler.go so a registry caller can branch on
// the same constants the HTTP layer accepts.
const (
	ModeOff   = "off"
	ModeLocal = "local"
	ModeCloud = "cloud"
)

// ProviderConfig is the typed view of one entry in
// settings.ai_provider_config.
//
// The on-the-wire shape is JSONB keyed by provider name:
//
//	{
//	  "default":   "ollama",
//	  "ollama":    {"base_url": "http://localhost:11434", "model": "llama3.1:8b-instruct-q4_K_M"},
//	  "openai":    {"base_url": "https://api.openai.com", "model": "gpt-4o-mini", "api_key": "sk-…"},
//	  "anthropic": {"base_url": "https://api.anthropic.com", "model": "claude-3-5-sonnet-20240620", "api_key": "sk-ant-…"}
//	}
//
// A future feature can add per-feature overrides under a
// "feature_overrides" key without breaking older agents that ignore it.
//
// API keys live in this map but are redacted from the GET /settings
// response when ai_mode='off' (ADR-015 §I9, enforced in
// internal/api/settings_handler.go).
type ProviderConfig struct {
	BaseURL        string `json:"base_url"`
	Model          string `json:"model,omitempty"`
	EmbeddingModel string `json:"embedding_model,omitempty"`
	APIKey         string `json:"api_key,omitempty"`

	// APIVersion is the wire-format API version some adapters need
	// to send as a query parameter. Currently consumed by the Azure
	// adapter (see [NameAzure]); other adapters ignore it. Empty
	// falls back to [DefaultAzureAPIVersion] for Azure.
	APIVersion string `json:"api_version,omitempty"`

	// Flavor selects between sub-surfaces of a single provider name.
	// Currently consumed by the Azure adapter, where it switches
	// between [AzureFlavorOpenAI] (Azure OpenAI Service —
	// deployment-name routing) and [AzureFlavorFoundry] (Azure AI
	// Foundry / Inference API — multi-vendor unified endpoint).
	// Other adapters ignore it. Empty falls back to
	// [DefaultAzureFlavor] for Azure.
	Flavor string `json:"flavor,omitempty"`

	// Deployment is the Azure chat deployment name when the
	// underlying URL routes by deployment (Azure OpenAI Service).
	// Empty falls back to [Model] so a user whose deployment is
	// named after the model (the common case) needs only one
	// field. Ignored by adapters that route by model identifier.
	Deployment string `json:"deployment,omitempty"`

	// EmbeddingDeployment mirrors [Deployment] for the embeddings
	// route. Falls back to [EmbeddingModel] when empty.
	EmbeddingDeployment string `json:"embedding_deployment,omitempty"`

	// PinnedIP is set by [ValidateLocal] at config-save time so the
	// runtime can detect DNS rebinding (R3 mitigation). Empty in
	// cloud mode and for built-in loopback hosts.
	PinnedIP string `json:"pinned_ip,omitempty"`
}

// SettingsView is the narrow shape the [Registry] needs from the live
// settings row. Implemented by *settingsdb.SettingsRepo in production
// wiring and by an in-memory fake in tests so the registry can be
// unit-tested without a database.
type SettingsView struct {
	Mode             string
	FeatureEnabled   map[string]bool
	ProviderConfig   map[string]any // raw shape from settings.ai_provider_config
	FeatureOverrides map[string]string
}

// ParseProviderConfig pulls one provider's typed config out of the raw
// map shape. Returns ([ErrMissingConfig]) wrapped with the provider
// name when the key is absent. Unknown fields are tolerated so a
// future server can add per-provider knobs without breaking older
// clients.
func ParseProviderConfig(raw map[string]any, providerName string) (ProviderConfig, error) {
	if providerName == "" {
		return ProviderConfig{}, fmt.Errorf("%w: empty provider name", ErrMissingConfig)
	}
	entry, ok := raw[providerName]
	if !ok {
		return ProviderConfig{}, fmt.Errorf("%w: %q", ErrMissingConfig, providerName)
	}
	asMap, ok := entry.(map[string]any)
	if !ok {
		// JSON unmarshal of "any" sometimes yields json.RawMessage
		// instead of map[string]any depending on the upstream
		// decoder; round-trip through json so callers do not have
		// to care.
		blob, err := json.Marshal(entry)
		if err != nil {
			return ProviderConfig{}, fmt.Errorf("%w: %q is not an object", ErrMissingConfig, providerName)
		}
		var cfg ProviderConfig
		if err := json.Unmarshal(blob, &cfg); err != nil {
			return ProviderConfig{}, fmt.Errorf("%w: %q decode: %v", ErrMissingConfig, providerName, err)
		}
		return applyDefaults(providerName, cfg), nil
	}
	blob, err := json.Marshal(asMap)
	if err != nil {
		return ProviderConfig{}, fmt.Errorf("%w: %q marshal: %v", ErrMissingConfig, providerName, err)
	}
	var cfg ProviderConfig
	if err := json.Unmarshal(blob, &cfg); err != nil {
		return ProviderConfig{}, fmt.Errorf("%w: %q decode: %v", ErrMissingConfig, providerName, err)
	}
	return applyDefaults(providerName, cfg), nil
}

// DefaultProviderForMode returns the canonical provider name for a
// top-level mode. local → ollama, cloud → openai. Returns "" for the
// off mode (the registry rejects off upstream so this is a safety
// net, not a happy-path code).
func DefaultProviderForMode(mode string) string {
	switch mode {
	case ModeLocal:
		return NameOllama
	case ModeCloud:
		return NameOpenAI
	}
	return ""
}

// ResolveProviderName picks the provider name for (mode, feature) using
// per-feature overrides when set, falling back to the explicit "default"
// key in the config map, then to [DefaultProviderForMode].
func ResolveProviderName(view SettingsView, featureID string) string {
	if name, ok := view.FeatureOverrides[featureID]; ok && name != "" {
		return name
	}
	if v, ok := view.ProviderConfig["default"]; ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return DefaultProviderForMode(view.Mode)
}

// applyDefaults seeds Model / EmbeddingModel / BaseURL when the user has
// not pinned them in settings. Keeps the registry call site terse and
// makes the defaults discoverable from one place (PD1/PD2/PD3 above).
func applyDefaults(providerName string, cfg ProviderConfig) ProviderConfig {
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	switch providerName {
	case NameOllama:
		if cfg.BaseURL == "" {
			cfg.BaseURL = DefaultLocalBaseURL
		}
		if cfg.Model == "" {
			cfg.Model = DefaultLocalModel
		}
		if cfg.EmbeddingModel == "" {
			cfg.EmbeddingModel = DefaultLocalEmbeddingModel
		}
	case NameOpenAI:
		if cfg.BaseURL == "" {
			cfg.BaseURL = DefaultCloudBaseURL
		}
		if cfg.Model == "" {
			cfg.Model = DefaultCloudModel
		}
		if cfg.EmbeddingModel == "" {
			cfg.EmbeddingModel = DefaultCloudEmbeddingModel
		}
	case NameAnthropic:
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.anthropic.com"
		}
		if cfg.Model == "" {
			cfg.Model = "claude-3-5-sonnet-20240620"
		}
	case NameAzure:
		// Azure: BaseURL is the user's resource endpoint
		// (https://{resource}.openai.azure.com for the OpenAI
		// flavor, or the Foundry endpoint for that flavor).
		// Deployment / EmbeddingDeployment fall back to Model /
		// EmbeddingModel inside the adapter, so no defaulting is
		// needed here. APIVersion + Flavor have stable defaults.
		if cfg.APIVersion == "" {
			cfg.APIVersion = DefaultAzureAPIVersion
		}
		if cfg.Flavor == "" {
			cfg.Flavor = DefaultAzureFlavor
		}
	}
	return cfg
}
