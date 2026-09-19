package provider

import (
	"encoding/json"
	"testing"
)

func TestModernFoundryConfigIgnoresObsoleteOverrides(t *testing.T) {
	cfg, err := ParseProviderConfig(map[string]any{NameAzure: map[string]any{
		"api_protocol": "responses", "model": "visible", "embedding_model": "embed",
		"deployment": "obsolete", "embedding_deployment": "obsolete-embed", "flavor": "openai",
	}}, NameAzure)
	if err != nil || cfg.Model != "visible" || cfg.EmbeddingModel != "embed" || cfg.APIProtocol != "responses" {
		t.Fatalf("cfg=%+v err=%v", cfg, err)
	}
}

func TestFoundryConfigurationMigration(t *testing.T) {
	for _, tc := range []struct{ name, flavor, deployment, want string }{
		{"override", "openai", "production-deployment", "production-deployment"},
		{"default-surface", "", "production-deployment", "production-deployment"},
		{"unused-override", "foundry", "stale-override", "visible-model"},
		{"no-override", "", "", "visible-model"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old := map[string]any{"azure": map[string]any{
				"base_url": "https://resource.services.ai.azure.com/openai/v1",
				"model":    "visible-model", "flavor": tc.flavor, "deployment": tc.deployment,
				"api_version": "obsolete", "embedding_model": "embedding-family",
				"embedding_deployment": "embedding-deployment", "api_key": "keep-key",
			}}
			cfg, err := ParseProviderConfig(old, NameAzure)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Model != tc.want || cfg.EmbeddingModel != "embedding-deployment" ||
				cfg.APIProtocol != FoundryProtocolAuto || cfg.APIKey != "keep-key" {
				t.Fatalf("migration=%+v", cfg)
			}
			raw, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			var saved map[string]any
			if err := json.Unmarshal(raw, &saved); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"flavor", "api_version", "deployment", "embedding_deployment"} {
				if _, present := saved[key]; present {
					t.Fatalf("obsolete key %s persisted", key)
				}
			}
			again, err := ParseProviderConfig(map[string]any{NameAzure: saved}, NameAzure)
			if err != nil || again != cfg {
				t.Fatalf("roundtrip=%+v err=%v", again, err)
			}
		})
	}
}
