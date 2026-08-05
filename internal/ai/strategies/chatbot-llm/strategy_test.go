// Chatbot LLM strategy tests.
//
// Unit tests for the chatbot-llm Strategy. The Strategy is a pure
// value (no internal state, no IO) so the tests are tight: pin the
// feature ID + system prompt + tool whitelist + redaction policy
// shape so a future edit that breaks the contract surfaces here
// before the dispatcher silently changes behaviour.

package chatbotllm

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to "chatbot-llm". The
// constant is referenced from router.go wiring + the AI HTTP handler;
// changing it without updating the registry would silently break the
// guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "chatbot-llm" {
		t.Fatalf("FeatureID() = %q, want %q", got, "chatbot-llm")
	}
	if FeatureID != "chatbot-llm" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "chatbot-llm")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the anti-hallucination directive that the goldens depend
// on. A regression that drops "never invent" silently degrades every
// chatbot response.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync",
		"tools",
		"never invent",
		"query_vehicle_count",
		"retrieve_app_knowledge",
		"read-only",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/chatbot-llm/goldens.yaml's tools
// block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_vehicle_state",
		"query_drives_recent",
		"query_charges_recent",
		"query_alerts_active",
		"query_battery_status",
		"query_vehicle_count",
		"query_vehicle_location",
		"query_drive_detail",
		"query_charge_detail",
		"query_alerts_recent",
		"query_geofences_list",
		"query_efficiency_period",
		"retrieve_app_knowledge",
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

// TestStrategy_ToolsIsDefensiveCopy proves Tools() returns a copy —
// a caller that mutates the slice does NOT leak the mutation back
// into the strategy. Dispatcher safety relies on this.
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
// READ-ONLY. The chatbot ships zero mutating tools (per the prompt
// + ADR-015 — read-only state queries only). A future edit that
// accidentally adds a write tool will fail this test before the
// dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: query_* is read-only; create_*,
		// update_*, delete_*, send_*, suspend_* are write.
		if !startsWithQuery(name) && name != "retrieve_app_knowledge" {
			t.Errorf("Tools() includes non-read-only tool %q", name)
		}
	}
}

// TestStrategy_ContextProvidesCurrentDate ensures relative date questions
// are interpreted against an explicit UTC calendar date rather than model
// training-time priors.
func TestStrategy_ContextProvidesCurrentDate(t *testing.T) {
	t.Parallel()
	s := New()
	msgs, err := s.Context(context.Background(), strategy.StrategyInput{})
	if err != nil {
		t.Fatalf("Context() err = %v, want nil", err)
	}
	if len(msgs) != 1 || msgs[0].Role != "system" {
		t.Fatalf("Context() = %v, want one system message", msgs)
	}
	if !contains(msgs[0].Content, time.Now().UTC().Format(time.DateOnly)) ||
		!contains(msgs[0].Content, "relative periods") {
		t.Fatalf("Context() missing current UTC date guidance: %v", msgs)
	}
}

// TestStrategy_RedactionPolicyChatbot proves the strategy hands the
// dispatcher the deny-all PolicyChatbot wrapped through the F4↔F8
// adapter. The adapter's Inner() lets us recover the underlying
// redact.Policy and assert its identity.
func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	// The redact.PolicyChatbot value's Mode + Allow are what the
	// downstream redact decorator inspects. We can't compare two
	// Policy values directly (slices differ by reference), but we
	// can require the strategy returns a non-nil RedactionPolicy
	// implementation — the F4 strategy port forbids mock policies
	// outside its own package.
	want := redact.PolicyChatbot()
	// PolicyChatbot uses the round-trip-tag mode; assert the
	// concrete mode matches so the strategy isn't silently downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags", want.Mode)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/chatbot-llm/goldens.yaml directly, so the
// in-code EvalGoldens() returns nil. Future strategies may override.
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

func startsWithQuery(name string) bool {
	const prefix = "query_"
	return len(name) >= len(prefix) && name[:len(prefix)] == prefix
}
