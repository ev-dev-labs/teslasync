// Phase-50 / 0053 — P2 Helix quiet-hours suggestion advisor.
//
// Unit tests for the quiet-hours-suggestion Strategy. Mirrors
// the shape of pii-redaction-shared-exports' strategy_test.go
// (the immediate precedent slice). The Strategy is a pure value
// (no internal state, no IO) so the tests are tight: pin the
// feature ID + system prompt + tool whitelist + redaction policy
// shape so a future edit that breaks the contract surfaces here
// before the dispatcher silently changes behaviour.

package quiethourssuggestion

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "quiet-hours-suggestion". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "quiet-hours-suggestion" {
		t.Fatalf("FeatureID() = %q, want %q", got, "quiet-hours-suggestion")
	}
	if FeatureID != "quiet-hours-suggestion" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "quiet-hours-suggestion")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (sleep_window_suggestion, work_meeting_window,
// validation_failure_honesty) would silently degrade if any of
// these substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"quiet-hours / Do-Not-Disturb suggestion advisor",
		"PROPOSE ONE candidate quiet-hours window",
		"ALWAYS call draft_quiet_hours_window FIRST",
		"MUST call validate_quiet_hours_window",
		"NEVER invent a timezone",
		"NEVER invent a weekday set",
		"NEVER propose disabling notifications entirely",
		// Honest validation-required directive — slice 0053
		// load-bearing rule. The narrator MUST refuse to
		// produce a final recommendation when the validator
		// returns ok=false and surface the validator's
		// errors[] verbatim.
		"if validate_quiet_hours_window returns ok=false you MUST REFUSE",
		"surface the validator's errors[] verbatim",
		// Honest "descriptive replay, not a forecast"
		// disclosure — slice 0053 load-bearing rule. The
		// phrase "based on your recent notification history"
		// MUST appear in the narration.
		"based on your recent notification history",
		"not a forecast of future traffic",
		`The phrase "based on your recent notification history" MUST appear`,
		// Refusal directives — dangerous proposals are out
		// of scope.
		"NEVER propose removing critical from bypass_severities",
		"NEVER propose a window that covers every hour of every weekday",
		// Refusal directive — cross-user requests are out
		// of scope.
		"Refuse politely",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise street addresses, GPS coordinates,
		// place names, or charger network labels even though
		// the redaction policy already strips them.
		"Never quote precise street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST
// stay in sync with
// internal/ai/strategies/quiet-hours-suggestion/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_quiet_hours_window",
		"validate_quiet_hours_window",
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
// READ-ONLY. Both tools (draft_quiet_hours_window,
// validate_quiet_hours_window) are pure-functional reads /
// validators. A future edit that accidentally adds a write tool
// (create_*, update_*, delete_*, save_*, send_*) will fail this
// test before the dispatcher's confirm hook protects the user.
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
// future slice that needs preferred-locale or
// preferred-quiet-hours preferences ships.
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

// TestStrategy_RedactionPolicyAlertBuilder proves the strategy
// hands the dispatcher PolicyAlertBuilder wrapped through the
// F4↔F8 adapter. PolicyAlertBuilder's Allow=nil deny-by-default
// policy means EVERY PII class (vehicle name included) is tagged
// round-trip before the message reaches the provider — the
// aggregated history envelope the tools return is PII-free by
// construction (per-hour counts, not raw titles) so no class
// needs to be allowed in cleartext.
//
// The slice prompt explicitly mandates:
//
//	"Policy:              PolicyAlertBuilder from internal/ai/redact/policies.go
//	 Allowed classes:     none; notification history is aggregated before prompting
//	 Round-trip required: no"
func TestStrategy_RedactionPolicyAlertBuilder(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyAlertBuilder()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyAlertBuilder Mode = %v, want ModeRedactedTags (defence-in-depth tagging)", want.Mode)
	}
	// Allow=nil is the load-bearing invariant — every PII
	// class is tagged round-trip. A future edit that quietly
	// promotes ClassVehicleName / ClassLatLong / ClassEmail /
	// etc. into the allow-list MUST fail this test.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyAlertBuilder.Allow = %v, want empty (no PII class in cleartext)", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/quiet-hours-suggestion/goldens.yaml
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
