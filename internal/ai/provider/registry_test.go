package provider

import (
	"context"
	"errors"
	"testing"
)

// fakeSettings implements [SettingsReader] for unit tests.
type fakeSettings struct {
	mode       string
	enabled    map[string]bool
	cfg        map[string]any
	modeErr    error
	enabledErr error
	cfgErr     error
}

func (f *fakeSettings) AIMode(_ context.Context) (string, error) {
	if f.modeErr != nil {
		return "", f.modeErr
	}
	return f.mode, nil
}
func (f *fakeSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if f.enabledErr != nil {
		return false, f.enabledErr
	}
	return f.enabled[id], nil
}
func (f *fakeSettings) AIProviderConfig(_ context.Context) (map[string]any, error) {
	if f.cfgErr != nil {
		return nil, f.cfgErr
	}
	return f.cfg, nil
}

// dummyProvider implements [Provider] with no behaviour, used as the
// adapter under test for [Registry].
type dummyProvider struct{ name string }

func (d *dummyProvider) Name() string { return d.name }
func (d *dummyProvider) Capabilities() Capabilities {
	return Capabilities{Tools: true, Streaming: true, Embeddings: true, MaxContext: 1234}
}
func (d *dummyProvider) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	return &ChatResponse{}, nil
}
func (d *dummyProvider) Stream(_ context.Context, _ ChatRequest) (<-chan Chunk, error) {
	ch := make(chan Chunk)
	close(ch)
	return ch, nil
}
func (d *dummyProvider) Embed(_ context.Context, _ EmbedRequest) (*EmbedResponse, error) {
	return &EmbedResponse{}, nil
}

func dummyBuilder(name string) Builder {
	return func(cfg ProviderConfig) (Provider, error) { return &dummyProvider{name: name}, nil }
}

// TestRegistry_For_OffMode_ReturnsErrProviderDisabled is the
// defence-in-depth test for ADR-015 §I1: even if the upstream guard is
// somehow bypassed, the registry refuses to construct a provider when
// ai_mode='off'.
func TestRegistry_For_OffMode_ReturnsErrProviderDisabled(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{mode: ModeOff})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	_, err := r.For(context.Background(), "chatbot-llm")
	if !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("want ErrProviderDisabled, got %v", err)
	}
}

// TestRegistry_For_FeatureOff covers per-feature gating.
func TestRegistry_For_FeatureOff(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{
		mode:    ModeLocal,
		enabled: map[string]bool{"chatbot-llm": false},
		cfg:     map[string]any{"ollama": map[string]any{}},
	})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	_, err := r.For(context.Background(), "chatbot-llm")
	if !errors.Is(err, ErrFeatureDisabled) {
		t.Fatalf("want ErrFeatureDisabled, got %v", err)
	}
}

// TestRegistry_For_LocalDefaultPath returns ollama when feature on +
// mode=local with no explicit default specified.
func TestRegistry_For_LocalDefaultPath(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{
		mode:    ModeLocal,
		enabled: map[string]bool{"chatbot-llm": true},
		cfg:     map[string]any{"ollama": map[string]any{"base_url": "http://localhost:11434"}},
	})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	p, err := r.For(context.Background(), "chatbot-llm")
	if err != nil {
		t.Fatalf("For: %v", err)
	}
	if p.Name() != NameOllama {
		t.Fatalf("got Name=%q, want %q", p.Name(), NameOllama)
	}
}

// TestRegistry_For_UnknownFeatureRejected catches the fail-fast on a
// bogus feature ID — guard wraps every route, so a request for a
// not-in-registry feature should never reach the registry, but the
// test pins the safety net.
func TestRegistry_For_UnknownFeatureRejected(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{mode: ModeLocal})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	_, err := r.For(context.Background(), "made-up-feature")
	if err == nil || !contains(err.Error(), "unknown feature") {
		t.Fatalf("want unknown-feature error, got %v", err)
	}
}

// TestRegistry_For_LocalNoConfigUsesDefaults proves the convenience
// fallback: in local mode with no provider config saved at all, the
// registry still returns ollama on its loopback default — so a fresh
// install can flip ai_mode='local' and immediately reach a local
// llama.cpp instance without an extra Settings save.
func TestRegistry_For_LocalNoConfigUsesDefaults(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{
		mode:    ModeLocal,
		enabled: map[string]bool{"chatbot-llm": true},
		cfg:     map[string]any{},
	})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	p, err := r.For(context.Background(), "chatbot-llm")
	if err != nil {
		t.Fatalf("For: %v", err)
	}
	if p.Name() != NameOllama {
		t.Fatalf("got Name=%q", p.Name())
	}
}

// TestRegistry_For_UnknownProviderName covers the case where the user
// pinned `default: anthropic` in settings but no anthropic builder is
// registered — must be rejected, never silently fallthrough.
func TestRegistry_For_UnknownProviderName(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{
		mode:    ModeLocal,
		enabled: map[string]bool{"chatbot-llm": true},
		cfg:     map[string]any{"default": "anthropic"},
	})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	_, err := r.For(context.Background(), "chatbot-llm")
	if !errors.Is(err, ErrUnknownProvider) {
		t.Fatalf("want ErrUnknownProvider, got %v", err)
	}
}

// TestRegistry_For_DBErrorFailsClosed: AIMode failing must NOT open the
// gate — must wrap ErrProviderDisabled so callers errors.Is past their
// happy path.
func TestRegistry_For_DBErrorFailsClosed(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{modeErr: errors.New("db down")})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	_, err := r.For(context.Background(), "chatbot-llm")
	if !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("want ErrProviderDisabled, got %v", err)
	}
}

// TestRegistry_HealthSnapshot_OffMode covers the off-mode short-circuit
// for the diagnostic endpoint. ADR-015 §I9: provider info must NOT
// leak in off mode.
func TestRegistry_HealthSnapshot_OffMode(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{mode: ModeOff})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	info, err := r.HealthSnapshot(context.Background(), "")
	if !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("want ErrProviderDisabled, got %v", err)
	}
	if info.Name != "" || info.Mode != "" {
		t.Fatalf("info leak: %+v", info)
	}
}

// TestRegistry_HealthSnapshot_LocalReportsAdapter
func TestRegistry_HealthSnapshot_LocalReportsAdapter(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{
		mode:    ModeLocal,
		enabled: map[string]bool{"ai-provider-health": true},
		cfg:     map[string]any{"ollama": map[string]any{}},
	})
	r.Register(NameOllama, dummyBuilder(NameOllama))
	info, err := r.HealthSnapshot(context.Background(), "ai-provider-health")
	if err != nil {
		t.Fatalf("HealthSnapshot: %v", err)
	}
	if info.Name != NameOllama || info.Mode != ModeLocal {
		t.Fatalf("info=%+v", info)
	}
	if info.Capabilities.MaxContext == 0 {
		t.Fatalf("capabilities not populated: %+v", info.Capabilities)
	}
}

// TestRegistry_Register_DuplicatePanics covers the boot-time fail-fast.
func TestRegistry_Register_DuplicatePanics(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{mode: ModeOff})
	r.Register("dup", dummyBuilder("dup"))
	defer func() {
		if rec := recover(); rec == nil {
			t.Fatal("duplicate Register did not panic")
		}
	}()
	r.Register("dup", dummyBuilder("dup"))
}

// TestRegistry_Names returns sorted names.
func TestRegistry_Names(t *testing.T) {
	t.Parallel()
	r := NewRegistry(&fakeSettings{mode: ModeOff})
	r.Register("zeta", dummyBuilder("zeta"))
	r.Register("alpha", dummyBuilder("alpha"))
	r.Register("mu", dummyBuilder("mu"))
	got := r.Names()
	want := []string{"alpha", "mu", "zeta"}
	if !slicesEqual(got, want) {
		t.Fatalf("Names() = %v, want %v", got, want)
	}
}

func contains(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
