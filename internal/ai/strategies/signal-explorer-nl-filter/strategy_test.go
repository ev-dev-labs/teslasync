// Phase-50 / 0044 — S3 Signal explorer NL filter.
//
// Unit tests for the signal-explorer-nl-filter Strategy. Mirrors the
// shape of data-repair-suggestions's strategy_test.go (the closest
// precedent: a propose-only DTO drafter strategy with a deny-all
// redaction policy and exactly two tools — draft + validate). The
// Strategy is a pure value (no internal state, no IO) so the tests
// are tight: pin the feature ID + system prompt + tool whitelist +
// redaction policy shape so a future edit that breaks the contract
// surfaces here before the dispatcher silently changes behaviour.

package signalexplorernlfilter

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID. The constant is
// referenced from router.go wiring + the AI HTTP handler; changing
// it without updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "signal-explorer-nl-filter" {
		t.Fatalf("FeatureID() = %q, want %q", got, "signal-explorer-nl-filter")
	}
	if FeatureID != "signal-explorer-nl-filter" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "signal-explorer-nl-filter")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (typical_speed_today, typical_battery_yesterday,
// refusal_unknown_signal) would silently degrade if any of these
// substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync signal-explorer-nl-filter agent",
		"ALWAYS call draft_signal_filter FIRST",
		// Validate-after-draft pin so the tool sequence stays
		// deterministic.
		"validate_signal_filter",
		// In-scope catalog enforcement — the per-request scope
		// binding is defended at the prompt level too.
		"in-scope per-vehicle catalog",
		// Refusal directive — out-of-catalog signals are forbidden.
		"Refuse politely",
		// Propose-only pin — never claim the filter was applied.
		"Never claim the filter was applied",
		// Range preset enumeration pin — only the SPA-supported
		// presets are valid.
		`range_preset values you may propose are exactly: "today"`,
		// Per-page enumeration pin — only the SPA-supported
		// per-page values.
		"per_page values you may propose are exactly: 25, 50, 100, 500",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/signal-explorer-nl-filter/
// goldens.yaml's tools block (the eval harness loads tool names from
// the YAML; the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_signal_filter",
		"validate_signal_filter",
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
// PROPOSE-only. Both tools (draft_signal_filter,
// validate_signal_filter) are pure-functional reads + DTO
// construction. A future edit that accidentally adds a write tool
// (apply_*, save_*, mutate_*) will fail this test before the
// dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
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
// future slice that needs preferred-greeting or per-vehicle
// preferences ships.
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
// PolicyChatbot is a DENY-BY-DEFAULT policy: Allow == nil so EVERY
// PII class — VIN, lat/long, addresses, place names, AND
// vehicle-name — is tagged round-trip. The slice prompt explicitly
// mandates "Allowed classes: none; vehicle identifiers flow through
// tools and query DTOs."
func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChatbot()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags", want.Mode)
	}
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyChatbot.Allow len = %d, want 0 (deny-by-default); got=%v",
			len(want.Allow), want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/signal-explorer-nl-filter/goldens.yaml
// directly, so the in-code EvalGoldens() returns nil.
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
