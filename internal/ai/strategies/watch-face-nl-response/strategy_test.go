// Phase-50 / 0056 — V2 Helix watch-face natural-language response.
//
// Unit tests for the watch-face-nl-response Strategy. The
// Strategy is a pure value (no internal state, no IO) so the
// tests are tight: pin the feature ID + system prompt + tool
// whitelist + redaction policy shape so a future edit that
// breaks the contract surfaces here before the dispatcher
// silently changes behaviour.

package watchfacenlresponse

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "watch-face-nl-response". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "watch-face-nl-response" {
		t.Fatalf("FeatureID() = %q, want %q", got, "watch-face-nl-response")
	}
	if FeatureID != "watch-face-nl-response" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "watch-face-nl-response")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (ask_battery_status, refuse_send_command,
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
		// Surface identity:
		"watch face",
		"smartwatch",
		// Tool-sequence directive:
		"ALWAYS call query_watch_context FIRST",
		// Watch-budget directives:
		"Keep replies SHORT",
		"1 to 2 sentences per turn",
		// Markdown / lists / code-blocks ban — watch panels
		// render plain text only:
		"NEVER use markdown",
		"NEVER use lists",
		"NEVER use code blocks",
		// Honest "read-only" directive — the narrator must
		// NEVER claim to have changed a setting or sent a
		// command. The deterministic tap-icons on the watch
		// face are the only command path.
		"NEVER claim to have changed a setting",
		"NEVER promise to send a vehicle command",
		// Refusal directive when the envelope cannot answer:
		"DO NOT fabricate an answer",
		// Defence-in-depth PII ban:
		"Never quote precise street addresses",
		// One-clarifying-question pattern (matches
		// chatbot-llm / voice-mode system-prompt convention):
		"ask one short clarifying question",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST
// stay in sync with
// internal/ai/strategies/watch-face-nl-response/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
//
// The slice prompt mandates exactly one tool — "Implement or
// register only the tools listed for this feature:
// query_watch_context." — so the whitelist length is a
// contract pin.
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_watch_context",
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

// TestStrategy_ToolsIsDefensiveCopy proves Tools() returns a copy
// — a caller that mutates the slice does NOT leak the mutation
// back into the strategy. Dispatcher safety relies on this.
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
// over the canonical VehicleRepo + LiveStateReader +
// NotificationRepo. A future edit that accidentally adds a write
// tool (create_*, update_*, delete_*, save_*, send_*) will fail
// this test before the dispatcher's confirm hook protects the
// user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		switch {
		case startsWith(name, "query_"),
			startsWith(name, "stream_"),
			startsWith(name, "retrieve_"):
			// OK — pure read.
		default:
			t.Errorf("Tools() includes non-read-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History
// + StrategyInput.LastMessage; the AI handler synthesises a
// turn-scoping user message before the call, so the strategy
// itself contributes no extra prefix messages.
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
// the dispatcher PolicyChatbot wrapped through the F4↔F8 adapter.
// PolicyChatbot's Allow=nil deny-by-default policy means EVERY
// PII class is tagged round-trip before the message reaches the
// provider — the typed envelope omits PII by construction, but
// the user's free-text question may contain PII (a place name
// the user typed, a name the user dictated), and the round-trip
// ModeRedactedTags policy strips them before the provider sees
// the message and restores them in the user-visible reply.
//
// The slice prompt explicitly mandates:
//
//	"Policy:              PolicyChatbot from internal/ai/redact/policies.go
//	 Allowed classes:     none; watch responses use tagged vehicle state and no secrets
//	 Round-trip required: yes"
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
// internal/ai/strategies/watch-face-nl-response/goldens.yaml
// directly, so the in-code EvalGoldens() returns nil. Future
// strategies may override.
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
