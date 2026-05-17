package cost

import (
	"testing"
)

// TestCompute_LocalProvidersAreFree pins ADR-015 §I4 spirit at the
// math layer: a self-hosted call must not produce a non-zero cost
// row, otherwise the usage card shows phantom spend for an offline
// install.
func TestCompute_LocalProvidersAreFree(t *testing.T) {
	t.Parallel()
	tests := []struct {
		provider string
		model    string
	}{
		{"ollama", "llama3.1:8b-instruct-q4_K_M"},
		{"ollama", "anything-the-user-pulled"},
		{"mock", "any-model"},
		{ProviderOllama, "nomic-embed-text"},
	}
	for _, tt := range tests {
		t.Run(tt.provider+"/"+tt.model, func(t *testing.T) {
			got := Compute(tt.provider, tt.model, 100_000, 50_000)
			if got != 0 {
				t.Fatalf("local provider %q model %q: cost=%d, want 0",
					tt.provider, tt.model, got)
			}
		})
	}
}

// TestCompute_OpenAIRates checks every known OpenAI model returns the
// integer-math result we expect. The numbers are derived in the test
// so a rate-table revision shows up here with the exact diff a
// reviewer needs to compare against the vendor's pricing page.
//
// Sanity reminder: Rate.{Input,Output}MicroCentsPerMillion is
// micro-cents per 1M tokens. So gpt-4o-mini at 150_000 mc/1M for input
// charges (N_in / 1_000_000) * 150_000 micro-cents.
func TestCompute_OpenAIRates(t *testing.T) {
	t.Parallel()
	cases := []struct {
		model      string
		in, out    int
		wantMicroC int64
	}{
		// gpt-4o-mini: 150_000 mc/1M in, 600_000 mc/1M out.
		// 1_000_000 in = 150_000 mc; 500_000 out = 300_000 mc.
		{"gpt-4o-mini", 1_000_000, 500_000, 150_000 + 300_000},

		// gpt-4o: 2_500_000 mc/1M in, 10_000_000 mc/1M out.
		// 200_000 in = 500_000 mc; 100_000 out = 1_000_000 mc.
		{"gpt-4o", 200_000, 100_000, 500_000 + 1_000_000},

		// gpt-4-turbo: 10_000_000 mc/1M in, 30_000_000 mc/1M out.
		// 100_000 in = 1_000_000 mc; 50_000 out = 1_500_000 mc.
		{"gpt-4-turbo", 100_000, 50_000, 1_000_000 + 1_500_000},

		// gpt-3.5-turbo: 500_000 mc/1M in, 1_500_000 mc/1M out.
		// 1_000_000 in + 1_000_000 out = 500_000 + 1_500_000.
		{"gpt-3.5-turbo", 1_000_000, 1_000_000, 500_000 + 1_500_000},

		// text-embedding-3-small 20_000 mc/1M input, no output.
		// 500_000 in = 10_000 mc.
		{"text-embedding-3-small", 500_000, 0, 10_000},
		// text-embedding-3-large 130_000 mc/1M input.
		// 1_000_000 in = 130_000 mc.
		{"text-embedding-3-large", 1_000_000, 0, 130_000},
	}
	for _, c := range cases {
		t.Run(c.model, func(t *testing.T) {
			got := Compute(ProviderOpenAI, c.model, c.in, c.out)
			if got != c.wantMicroC {
				t.Fatalf("Compute(openai, %s, %d, %d) = %d, want %d",
					c.model, c.in, c.out, got, c.wantMicroC)
			}
		})
	}
}

// TestCompute_AnthropicRates pins the Anthropic rate table the same
// way TestCompute_OpenAIRates pins OpenAI's. Numbers reviewed against
// https://www.anthropic.com/pricing during Phase-50.
func TestCompute_AnthropicRates(t *testing.T) {
	t.Parallel()
	cases := []struct {
		model      string
		in, out    int
		wantMicroC int64
	}{
		// claude-3-5-sonnet: 3_000_000 mc/1M in, 15_000_000 mc/1M out.
		// 100_000 in = 300_000 mc; 50_000 out = 750_000 mc.
		{"claude-3-5-sonnet-20240620", 100_000, 50_000, 300_000 + 750_000},

		// claude-3-5-haiku: 800_000 mc/1M in, 4_000_000 mc/1M out.
		// 1_000_000 in = 800_000 mc; 1_000_000 out = 4_000_000 mc.
		{"claude-3-5-haiku-20241022", 1_000_000, 1_000_000, 800_000 + 4_000_000},

		// claude-3-opus: 15_000_000 mc/1M in, 75_000_000 mc/1M out.
		// 10_000 in = 150_000 mc; 5_000 out = 375_000 mc.
		{"claude-3-opus-20240229", 10_000, 5_000, 150_000 + 375_000},
	}
	for _, c := range cases {
		t.Run(c.model, func(t *testing.T) {
			got := Compute(ProviderAnthropic, c.model, c.in, c.out)
			if got != c.wantMicroC {
				t.Fatalf("Compute(anthropic, %s, %d, %d) = %d, want %d",
					c.model, c.in, c.out, got, c.wantMicroC)
			}
		})
	}
}

// TestCompute_UnknownTuplesAreFree enforces the "audit-but-don't-bill"
// fallback for models we haven't priced. Returning 0 lets the call
// still be recorded in ai_call_log so the operator sees the volume,
// but the usage card's $ column will read 0 — which is the correct
// signal to "add this model to the rate table".
func TestCompute_UnknownTuplesAreFree(t *testing.T) {
	t.Parallel()
	tests := []struct {
		provider, model string
	}{
		{"openai", "gpt-9999"},                            // unknown model
		{"unknown-provider", "anything"},                  // unknown provider
		{"", ""},                                          // empty inputs
		{"OpenAI", "gpt-4o-mini-typo"},                    // case-insensitive but mistyped
	}
	for _, tt := range tests {
		t.Run(tt.provider+"/"+tt.model, func(t *testing.T) {
			got := Compute(tt.provider, tt.model, 1_000_000, 1_000_000)
			if got != 0 {
				t.Fatalf("unknown (%q,%q) cost=%d, want 0",
					tt.provider, tt.model, got)
			}
		})
	}
}

// TestCompute_NegativeTokensClamp guards the decorator hot path: even
// if a buggy adapter reports a negative token count (some open-source
// runtimes return -1 for "unknown"), the bill must not go negative.
func TestCompute_NegativeTokensClamp(t *testing.T) {
	t.Parallel()
	got := Compute(ProviderOpenAI, "gpt-4o-mini", -10_000, -5_000)
	if got != 0 {
		t.Fatalf("negative token cost = %d, want 0", got)
	}

	// Mixed: negative input is clamped to 0 but positive output is
	// charged normally. 0 in + 1_000_000 out at 600_000 mc/1M output =
	// 600_000 micro-cents.
	got = Compute(ProviderOpenAI, "gpt-4o-mini", -10_000, 1_000_000)
	if got != 600_000 {
		t.Fatalf("mixed-negative cost = %d, want 600000", got)
	}
}

// TestCompute_CaseInsensitive proves a settings.ai_provider_config
// entry that recorded the model in mixed case still matches the
// canonical lower-case rate row. Without this the operator would see
// $0 spend for a real call simply because they capitalised "GPT-4o".
func TestCompute_CaseInsensitive(t *testing.T) {
	t.Parallel()
	want := Compute(ProviderOpenAI, "gpt-4o-mini", 1_000_000, 0)
	upperProvider := Compute("OPENAI", "gpt-4o-mini", 1_000_000, 0)
	upperModel := Compute(ProviderOpenAI, "GPT-4o-Mini", 1_000_000, 0)
	if want == 0 {
		t.Fatal("baseline cost is 0; rate table missing")
	}
	if upperProvider != want || upperModel != want {
		t.Fatalf("case sensitivity drift: base=%d UPPER provider=%d UPPER model=%d",
			want, upperProvider, upperModel)
	}
}

// TestHasRate covers the "do we know how to bill this?" check used by
// tests + the future Cost-estimate UI tooltip.
func TestHasRate(t *testing.T) {
	t.Parallel()
	if !HasRate("openai", "gpt-4o-mini") {
		t.Fatal("expected gpt-4o-mini to be priced")
	}
	if HasRate("openai", "gpt-9999") {
		t.Fatal("unknown model should not be priced")
	}
	if HasRate("ollama", "llama3.1") {
		// Ollama provider is registered but has no model entries.
		// HasRate should report false; Compute returns 0 either way.
		t.Fatal("ollama with no model entry should report HasRate=false")
	}
}

// TestKnownProvidersAndModels guards against a future change that
// silently drops a provider or model from the table — the snapshot
// asserts the exact set we expect to ship with.
func TestKnownProvidersAndModels(t *testing.T) {
	t.Parallel()
	wantProviders := []string{"anthropic", "azure", "mock", "ollama", "openai"}
	got := KnownProviders()
	if !equal(got, wantProviders) {
		t.Fatalf("KnownProviders() = %v, want %v", got, wantProviders)
	}

	wantOpenAI := []string{
		"gpt-3.5-turbo", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini",
		"text-embedding-3-large", "text-embedding-3-small",
	}
	if got := ModelsFor("openai"); !equal(got, wantOpenAI) {
		t.Fatalf("ModelsFor(openai) = %v, want %v", got, wantOpenAI)
	}

	wantAnthropic := []string{
		"claude-3-5-haiku-20241022", "claude-3-5-sonnet-20240620", "claude-3-opus-20240229",
	}
	if got := ModelsFor("anthropic"); !equal(got, wantAnthropic) {
		t.Fatalf("ModelsFor(anthropic) = %v, want %v", got, wantAnthropic)
	}

	wantAzure := []string{
		"cohere-command-r-plus-08-2024",
		"gpt-3.5-turbo", "gpt-35-turbo", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini",
		"meta-llama-3.1-70b-instruct", "meta-llama-3.1-8b-instruct",
		"mistral-large-2407", "mistral-small-2409",
		"phi-3.5-mini-instruct",
		"text-embedding-3-large", "text-embedding-3-small",
	}
	if got := ModelsFor("azure"); !equal(got, wantAzure) {
		t.Fatalf("ModelsFor(azure) = %v, want %v", got, wantAzure)
	}

	if got := ModelsFor("ollama"); len(got) != 0 {
		t.Fatalf("ModelsFor(ollama) = %v, want empty (local provider)", got)
	}

	if got := ModelsFor("nope"); got != nil {
		t.Fatalf("ModelsFor(nope) = %v, want nil", got)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
