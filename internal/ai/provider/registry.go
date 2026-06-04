package provider

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/ai/features"
)

// SettingsReader is the narrow view the [Registry] needs from the live
// settings row. Implemented by *settingsdb.SettingsRepo in production
// wiring and by an in-memory fake in tests.
//
// Methods MUST fail-closed: any error path returns the off-mode default
// (mode="off", feature disabled, empty config) so a transient DB
// outage cannot accidentally open the gate.
type SettingsReader interface {
	AIMode(ctx context.Context) (string, error)
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
	AIProviderConfig(ctx context.Context) (map[string]any, error)
}

// Builder constructs a concrete [Provider] from the typed config.
// Adapter packages register themselves with the [Registry] by passing
// their builder; the registry composes the result with the standard
// decorator chain.
type Builder func(cfg ProviderConfig) (Provider, error)

// Registry is the single selection point for AI provider adapters.
// One instance is built at app startup ([app.New]) and shared across
// every feature handler. Adapters are registered once, configuration
// is read on every [For] call so a settings update takes effect on the
// next request without a restart.
//
// The decorator chain (currently only [WithTrace]) wraps every
// returned [Provider] so feature code does not need to call WithTrace
// directly.
type Registry struct {
	mu         sync.RWMutex
	settings   SettingsReader
	builders   map[string]Builder
	decorators []Decorator
}

// NewRegistry constructs a Registry that reads from settings and
// applies the supplied decorators (in slice order, outer-to-inner) to
// every returned provider. Pass decorators at construction time as
// tracing, audit, redaction, or health concerns are enabled.
func NewRegistry(settings SettingsReader, decorators ...Decorator) *Registry {
	if settings == nil {
		panic("ai/provider: NewRegistry called with nil SettingsReader")
	}
	return &Registry{
		settings:   settings,
		builders:   make(map[string]Builder),
		decorators: decorators,
	}
}

// Register installs a builder for the named provider. Adapters call
// this from their package init() so a new adapter import is enough to
// make it available — no central enum to update. Panics on duplicate
// registration so a typo at boot fails fast.
func (r *Registry) Register(name string, b Builder) {
	if name == "" {
		panic("ai/provider: Register called with empty name")
	}
	if b == nil {
		panic("ai/provider: Register called with nil builder for " + name)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.builders[name]; dup {
		panic("ai/provider: duplicate Register for " + name)
	}
	r.builders[name] = b
}

// Names returns the registered provider names in deterministic order
// for diagnostics (used by the AI Provider Health debug endpoint).
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.builders))
	for name := range r.builders {
		out = append(out, name)
	}
	// Stable order — sort doesn't import anything heavy in this file.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

// For resolves the active provider for (featureID) using the live
// settings row. Returns:
//
//   - [ErrProviderDisabled] when ai_mode='off' (defence in depth — the
//     guard returns 404 upstream).
//   - [ErrFeatureDisabled] when the per-feature toggle is off.
//   - [ErrUnknownProvider] when settings name a provider with no builder.
//   - [ErrMissingConfig] when settings have no config block for the
//     resolved provider name.
//
// On success the returned [Provider] is wrapped by the registry's
// decorator chain.
func (r *Registry) For(ctx context.Context, featureID string) (Provider, error) {
	if !features.IsKnown(featureID) {
		return nil, fmt.Errorf("ai/provider: unknown feature %q", featureID)
	}
	mode, err := r.settings.AIMode(ctx)
	if err != nil {
		return nil, errors.Join(ErrProviderDisabled, err)
	}
	if mode == ModeOff {
		return nil, ErrProviderDisabled
	}
	enabled, err := r.settings.AIFeatureEnabled(ctx, featureID)
	if err != nil {
		return nil, errors.Join(ErrFeatureDisabled, err)
	}
	if !enabled {
		return nil, ErrFeatureDisabled
	}
	rawCfg, err := r.settings.AIProviderConfig(ctx)
	if err != nil {
		return nil, errors.Join(ErrMissingConfig, err)
	}
	view := SettingsView{
		Mode:           mode,
		ProviderConfig: rawCfg,
	}
	name := ResolveProviderName(view, featureID)
	if name == "" {
		return nil, fmt.Errorf("%w: no default provider for mode %q", ErrUnknownProvider, mode)
	}
	r.mu.RLock()
	build, ok := r.builders[name]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownProvider, name)
	}
	cfg, err := ParseProviderConfig(rawCfg, name)
	if err != nil {
		// Embedded config missing — fall back to a defaulted empty
		// config so a fresh local-mode install with no provider edits
		// can still reach Ollama on its loopback default. Cloud mode
		// has no usable default (no API key) so propagate the error.
		if errors.Is(err, ErrMissingConfig) && name == NameOllama && mode == ModeLocal {
			cfg = applyDefaults(name, ProviderConfig{})
		} else {
			return nil, err
		}
	}
	p, err := build(cfg)
	if err != nil {
		return nil, fmt.Errorf("ai/provider: build %s: %w", name, err)
	}
	return Chain(p, r.decorators...), nil
}

// ProviderForName builds a provider directly by name + config without
// consulting settings. Used by the AI Provider Health debug endpoint
// which wants to advertise the *currently active* adapter regardless
// of feature gating.
func (r *Registry) ProviderForName(name string, cfg ProviderConfig) (Provider, error) {
	r.mu.RLock()
	build, ok := r.builders[name]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownProvider, name)
	}
	p, err := build(cfg)
	if err != nil {
		return nil, fmt.Errorf("ai/provider: build %s: %w", name, err)
	}
	return Chain(p, r.decorators...), nil
}

// ActiveProviderInfo bundles the active provider's diagnostic info for
// the provider-health debug endpoint. Returned by [Registry.HealthSnapshot].
type ActiveProviderInfo struct {
	Mode         string       `json:"mode"`
	Name         string       `json:"name"`
	Capabilities Capabilities `json:"capabilities"`
}

// HealthSnapshot returns the currently active provider's name +
// capabilities for ops diagnostics. Honours the same off-mode +
// feature-toggle gates [For] applies; on disabled it returns
// (ActiveProviderInfo{}, ErrProviderDisabled / ErrFeatureDisabled).
//
// featureID identifies the diagnostic feature flag the caller used to
// reach this method (typically "ai-provider-health"). The flag is what
// the upstream guard consulted; HealthSnapshot re-checks it so a bypass
// still cannot leak provider info.
func (r *Registry) HealthSnapshot(ctx context.Context, featureID string) (ActiveProviderInfo, error) {
	mode, err := r.settings.AIMode(ctx)
	if err != nil {
		return ActiveProviderInfo{}, errors.Join(ErrProviderDisabled, err)
	}
	if mode == ModeOff {
		return ActiveProviderInfo{}, ErrProviderDisabled
	}
	if featureID != "" {
		enabled, err := r.settings.AIFeatureEnabled(ctx, featureID)
		if err != nil {
			return ActiveProviderInfo{}, errors.Join(ErrFeatureDisabled, err)
		}
		if !enabled {
			return ActiveProviderInfo{}, ErrFeatureDisabled
		}
	}
	rawCfg, err := r.settings.AIProviderConfig(ctx)
	if err != nil {
		return ActiveProviderInfo{}, errors.Join(ErrMissingConfig, err)
	}
	view := SettingsView{Mode: mode, ProviderConfig: rawCfg}
	name := ResolveProviderName(view, "")
	if name == "" {
		return ActiveProviderInfo{}, fmt.Errorf("%w: no default provider for mode %q", ErrUnknownProvider, mode)
	}
	cfg, err := ParseProviderConfig(rawCfg, name)
	if err != nil {
		if errors.Is(err, ErrMissingConfig) && name == NameOllama && mode == ModeLocal {
			cfg = applyDefaults(name, ProviderConfig{})
		} else {
			return ActiveProviderInfo{}, err
		}
	}
	r.mu.RLock()
	build, ok := r.builders[name]
	r.mu.RUnlock()
	if !ok {
		return ActiveProviderInfo{}, fmt.Errorf("%w: %q", ErrUnknownProvider, name)
	}
	p, err := build(cfg)
	if err != nil {
		return ActiveProviderInfo{}, fmt.Errorf("ai/provider: build %s: %w", name, err)
	}
	return ActiveProviderInfo{
		Mode:         mode,
		Name:         p.Name(),
		Capabilities: p.Capabilities(),
	}, nil
}
