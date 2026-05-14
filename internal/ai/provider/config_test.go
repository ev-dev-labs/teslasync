package provider

import (
	"errors"
	"testing"
)

// TestParseProviderConfig_HappyPath_Ollama covers the canonical local
// install: the user has saved an ollama config block; parser should
// emit the typed view with the user's base_url respected.
func TestParseProviderConfig_HappyPath_Ollama(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"ollama": map[string]any{
			"base_url": "http://10.0.0.5:11434",
			"model":    "llama3.1:70b-instruct",
		},
	}
	cfg, err := ParseProviderConfig(raw, NameOllama)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.BaseURL != "http://10.0.0.5:11434" {
		t.Fatalf("base_url=%q", cfg.BaseURL)
	}
	if cfg.Model != "llama3.1:70b-instruct" {
		t.Fatalf("model=%q", cfg.Model)
	}
	if cfg.EmbeddingModel != DefaultLocalEmbeddingModel {
		t.Fatalf("embedding default not applied: %q", cfg.EmbeddingModel)
	}
}

// TestParseProviderConfig_AppliesDefaults proves an empty entry
// resolves to the PD defaults (PD1/PD2/PD3) for the requested provider.
func TestParseProviderConfig_AppliesDefaults(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"ollama": map[string]any{},
		"openai": map[string]any{"api_key": "sk-test"},
	}

	t.Run("ollama defaults", func(t *testing.T) {
		cfg, err := ParseProviderConfig(raw, NameOllama)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if cfg.BaseURL != DefaultLocalBaseURL || cfg.Model != DefaultLocalModel || cfg.EmbeddingModel != DefaultLocalEmbeddingModel {
			t.Fatalf("PD defaults not applied: %+v", cfg)
		}
	})
	t.Run("openai defaults", func(t *testing.T) {
		cfg, err := ParseProviderConfig(raw, NameOpenAI)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if cfg.BaseURL != DefaultCloudBaseURL || cfg.Model != DefaultCloudModel || cfg.EmbeddingModel != DefaultCloudEmbeddingModel {
			t.Fatalf("PD defaults not applied: %+v", cfg)
		}
		if cfg.APIKey != "sk-test" {
			t.Fatalf("api_key dropped: %+v", cfg)
		}
	})
}

// TestParseProviderConfig_TrailingSlashStripped covers the small but
// classic source of bugs where the user pastes "http://host:11434/" and
// the adapter then emits "http://host:11434//api/chat".
func TestParseProviderConfig_TrailingSlashStripped(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"ollama": map[string]any{"base_url": "http://localhost:11434/"},
	}
	cfg, err := ParseProviderConfig(raw, NameOllama)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.BaseURL != "http://localhost:11434" {
		t.Fatalf("trailing slash not stripped: %q", cfg.BaseURL)
	}
}

// TestParseProviderConfig_MissingProvider returns ErrMissingConfig.
func TestParseProviderConfig_MissingProvider(t *testing.T) {
	t.Parallel()
	raw := map[string]any{}
	_, err := ParseProviderConfig(raw, NameOllama)
	if !errors.Is(err, ErrMissingConfig) {
		t.Fatalf("want ErrMissingConfig, got %v", err)
	}
}

// TestParseProviderConfig_EmptyProviderName rejects ambiguous input.
func TestParseProviderConfig_EmptyProviderName(t *testing.T) {
	t.Parallel()
	_, err := ParseProviderConfig(map[string]any{}, "")
	if !errors.Is(err, ErrMissingConfig) {
		t.Fatalf("want ErrMissingConfig, got %v", err)
	}
}

// TestDefaultProviderForMode pins the local→ollama, cloud→openai
// mapping that the rest of the system relies on.
func TestDefaultProviderForMode(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		ModeOff:   "",
		ModeLocal: NameOllama,
		ModeCloud: NameOpenAI,
		"unknown": "",
	}
	for mode, want := range cases {
		if got := DefaultProviderForMode(mode); got != want {
			t.Fatalf("DefaultProviderForMode(%q) = %q, want %q", mode, got, want)
		}
	}
}

// TestResolveProviderName_PrecedenceOrder asserts feature override beats
// explicit "default" beats mode default.
func TestResolveProviderName_PrecedenceOrder(t *testing.T) {
	t.Parallel()

	t.Run("feature override wins", func(t *testing.T) {
		view := SettingsView{
			Mode:           ModeCloud,
			ProviderConfig: map[string]any{"default": NameOpenAI},
			FeatureOverrides: map[string]string{
				"chatbot-llm": NameAnthropic,
			},
		}
		if got := ResolveProviderName(view, "chatbot-llm"); got != NameAnthropic {
			t.Fatalf("override ignored: %q", got)
		}
	})
	t.Run("explicit default wins over mode default", func(t *testing.T) {
		view := SettingsView{
			Mode:           ModeCloud,
			ProviderConfig: map[string]any{"default": NameAnthropic},
		}
		if got := ResolveProviderName(view, "any"); got != NameAnthropic {
			t.Fatalf("default ignored: %q", got)
		}
	})
	t.Run("mode default applies when nothing else set", func(t *testing.T) {
		view := SettingsView{Mode: ModeLocal, ProviderConfig: map[string]any{}}
		if got := ResolveProviderName(view, "any"); got != NameOllama {
			t.Fatalf("mode default missing: %q", got)
		}
	})
	t.Run("off mode resolves to empty", func(t *testing.T) {
		view := SettingsView{Mode: ModeOff, ProviderConfig: map[string]any{}}
		if got := ResolveProviderName(view, "any"); got != "" {
			t.Fatalf("off mode should resolve empty, got %q", got)
		}
	})
}
