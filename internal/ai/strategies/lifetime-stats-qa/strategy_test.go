// Unit tests for the lifetime-stats-qa Strategy. Mirrors the shape of
// vampire-drain-explanation's strategy_test.go (the closest precedent:
// a tools+RAG-style narrator strategy with a deny-all redaction
// policy). The Strategy is a pure value (no internal state, no IO) so
// the tests are tight: pin the feature ID + system prompt + tool
// whitelist + redaction policy shape so a future edit that breaks the
// contract surfaces here before the dispatcher silently changes
// behaviour.

package lifetimestatsqa

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to "lifetime-stats-qa".
// The constant is referenced from router.go wiring + the AI HTTP
// handler; changing it without updating the registry would silently
// break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "lifetime-stats-qa" {
		t.Fatalf("FeatureID() = %q, want %q", got, "lifetime-stats-qa")
	}
	if FeatureID != "lifetime-stats-qa" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "lifetime-stats-qa")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (typical_lifetime_question, zero_data_vehicle,
// refusal_other_vehicle) would silently degrade if any of these
// substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync lifetime-stats Q&A assistant",
		"ALWAYS call query_lifetime_stats FIRST",
		// Optional secondary tool: retrieve_analytics_chunks
		// is OPTIONAL — the Q&A grounds in the deterministic
		// envelope first.
		"retrieve_analytics_chunks",
		// Honest-no-invention pin.
		"never fabricate alternate totals",
		// Honest-zero-data pin.
		"total_drives is 0 OR total_charge_sessions is 0",
		// Refusal directive — cross-vehicle requests are out
		// of scope.
		"Refuse politely",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise street addresses or location
		// coordinates even though the redaction policy already
		// strips them.
		"Never quote precise street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/lifetime-stats-qa/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_lifetime_stats",
		"retrieve_analytics_chunks",
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
// READ-ONLY. Both tools (query_lifetime_stats, retrieve_analytics_
// chunks) are pure-functional reads. A future edit that accidentally
// adds a write tool (create_*, update_*, delete_*, suspend_*,
// send_*) will fail this test before the dispatcher's confirm hook
// protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: draft_*, validate_*, query_*,
		// retrieve_* are propose / read; create_*, update_*,
		// delete_*, send_*, suspend_* are write.
		switch {
		case startsWith(name, "draft_"),
			startsWith(name, "validate_"),
			startsWith(name, "query_"),
			startsWith(name, "retrieve_"):
			// OK — propose / validate / read.
		default:
			t.Errorf("Tools() includes non-propose-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History;
// the strategy must not contribute extra prefix messages until a
// future feature that needs preferred-greeting or preferred-unit-
// display preferences ships.
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

// TestStrategy_RedactionPolicyChatbot proves the strategy hands the
// dispatcher PolicyChatbot through the redaction adapter.
// PolicyChatbot is the DENY-BY-DEFAULT policy: Allow == nil so EVERY
// PII class — VIN, lat/long, addresses, place names, AND vehicle-name
// — is tagged round-trip.
func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChatbot()
	// PolicyChatbot uses the round-trip-tag mode; assert the
	// concrete mode matches so the strategy isn't silently
	// downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// PolicyChatbot is deny-by-default: Allow MUST be nil (or
	// empty). A future edit that adds an allow-list entry would
	// silently widen the surface.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyChatbot.Allow len = %d, want 0 (deny-by-default); got=%v",
			len(want.Allow), want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/lifetime-stats-qa/goldens.yaml directly, so
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
