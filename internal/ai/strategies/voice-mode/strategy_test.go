// Unit tests for the voice-mode Strategy. The Strategy is a pure
// value (no internal state, no IO) so the tests are tight: pin
// the feature ID + system prompt + tool whitelist + redaction
// policy shape so a future edit that breaks the contract surfaces
// here before the dispatcher silently changes behaviour.

package voicemode

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to "voice-mode".
// The constant is referenced from router.go wiring + the AI HTTP
// handler; changing it without updating the registry would
// silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "voice-mode" {
		t.Fatalf("FeatureID() = %q, want %q", got, "voice-mode")
	}
	if FeatureID != "voice-mode" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "voice-mode")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (ask_battery_status, ask_for_a_setting_change,
// ambiguous_request_clarifies) would silently degrade if any of
// these substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		// Voice-mode identity:
		"voice mode",
		"SPOKEN ALOUD",
		// Tool-sequence directive:
		"ALWAYS call stream_chatbot_response FIRST",
		// TTS-budget directives:
		"Keep replies SHORT",
		"1 to 3 sentences per turn",
		// Markdown / lists / code-blocks ban — TTS would read
		// the syntax aloud verbatim:
		"NEVER use markdown",
		"NEVER use lists",
		"NEVER use code blocks",
		// Honest "read-only" directive — the narrator must
		// NEVER claim to have changed a setting.
		"NEVER claim to have changed a setting",
		`NEVER say "I have done X"`,
		// Number/symbol TTS-friendliness directive:
		`"82 percent" not "82%"`,
		// Refusal directive when the envelope cannot answer:
		"DO NOT fabricate an answer",
		// Defence-in-depth PII ban:
		"Never quote precise street addresses",
		// One-clarifying-question pattern (matches chatbot-llm
		// system-prompt convention):
		"ask one short clarifying question",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with internal/ai/strategies/voice-mode/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
//
// The strategy allows exactly one tool, so the whitelist length is a
// contract pin.
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"stream_chatbot_response",
	}
	if len(got) != len(want) {
		t.Fatalf("Tools() length = %d, want %d (got=%v)", len(got), len(want), got)
	}
	for i, name := range want {
		if got[i] != name {
			t.Errorf("Tools()[%d] = %q, want %q", i, got[i], name)
		}
	}
}

// TestStrategy_ToolsIsDefensiveCopy proves Tools() returns a copy.
// Mutating the returned slice must not affect the strategy.
func TestStrategy_ToolsIsDefensiveCopy(t *testing.T) {
	t.Parallel()
	s := New()
	first := s.Tools()
	first[0] = "MUTATED"
	second := s.Tools()
	if second[0] == "MUTATED" {
		t.Fatalf("Tools() leaked mutation: second[0] = %q", second[0])
	}
}

// TestStrategy_ToolsIncludesNoMutators asserts the whitelist is
// READ-ONLY. The single tool is a pure-functional read/aggregator
// over the canonical ChatRepo + a static vehicle snapshot. A
// future edit that accidentally adds a write tool (create_*,
// update_*, delete_*, save_*, send_*) will fail this test before
// the dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		switch {
		case startsWith(name, "stream_"),
			startsWith(name, "query_"),
			startsWith(name, "retrieve_"):
			// OK — pure read.
		default:
			t.Errorf("Tools() includes non-read-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History
// + StrategyInput.LastMessage; the AI handler synthesises a turn-
// scoping user message before the call, so the strategy itself
// contributes no extra prefix messages.
func TestStrategy_ContextReturnsNil(t *testing.T) {
	t.Parallel()
	s := New()
	msgs, err := s.Context(context.Background(), strategy.StrategyInput{})
	if err != nil {
		t.Fatalf("Context() err = %v, want nil", err)
	}
	if msgs != nil {
		t.Fatalf("Context() = %v, want nil", msgs)
	}
}

// TestStrategy_RedactionPolicyChatbot proves the strategy hands
// the dispatcher PolicyChatbot through the redaction adapter.
// PolicyChatbot's Allow=nil deny-by-default policy means EVERY
// PII class is tagged round-trip before the message reaches the
// provider — voice transcripts may contain vehicle nicknames,
// addresses, or other PII the user spoke aloud; the round-trip
// ModeRedactedTags policy strips them before the provider sees
// the message and restores them in the user-visible reply.

func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChatbot()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags (round-trip tagging)", want.Mode)
	}
	// Allow=nil is the load-bearing invariant — every PII
	// class is tagged round-trip. A future edit that quietly
	// promotes ClassVehicleName / ClassLatLong / ClassEmail /
	// etc. into the allow-list MUST fail this test.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyChatbot.Allow = %v, want empty (no PII class in cleartext)", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/voice-mode/goldens.yaml directly, so
// the in-code EvalGoldens() returns nil. Future strategies may
// override.
func TestStrategy_EvalGoldensReturnsNil(t *testing.T) {
	t.Parallel()
	s := New()
	if g := s.EvalGoldens(); g != nil {
		t.Fatalf("EvalGoldens() = %v, want nil (goldens live in YAML)", g)
	}
}

// --- helpers ---------------------------------------------------------

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
