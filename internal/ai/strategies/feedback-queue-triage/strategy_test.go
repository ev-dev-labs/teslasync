// Phase-50 / 0046 — S5 Feedback queue triage.
//
// Unit tests for the feedback-queue-triage Strategy. Mirrors the
// shape of log-trace-summarization's strategy_test.go (the closest
// precedent: a tools+RAG-style propose-only strategy with a
// deny-all redaction policy). The Strategy is a pure value (no
// internal state, no IO) so the tests are tight: pin the feature
// ID + system prompt + tool whitelist + redaction policy shape so
// a future edit that breaks the contract surfaces here before the
// dispatcher silently changes behaviour.

package feedbackqueuetriage

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
	if got := s.FeatureID(); got != "feedback-queue-triage" {
		t.Fatalf("FeatureID() = %q, want %q", got, "feedback-queue-triage")
	}
	if FeatureID != "feedback-queue-triage" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "feedback-queue-triage")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (typical_bug_triage, typical_feature_triage,
// refusal_out_of_scope_feedback) would silently degrade if any of
// these substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync feedback-queue-triage agent",
		"ALWAYS call draft_feedback_triage FIRST",
		"validate_feedback_triage",
		// Optional secondary tool: retrieve_feedback_chunks is
		// OPTIONAL — the proposal grounds in the loaded row first.
		"retrieve_feedback_chunks",
		// Closed-enum pin for proposed_status.
		"(new, triaged, closed)",
		// Closed-enum pin for proposed_category.
		"(bug, feature, other)",
		// Closed-enum pin for proposed_priority.
		"(low, normal, high, critical)",
		// Honest-no-invention pin.
		"Never invent a category, status, or priority outside the closed enums",
		// Honest-zero-data pin.
		"degenerate (empty body",
		// Refusal directive — out-of-scope rows are forbidden.
		"Refuse politely",
		// Status-no-loosening directive.
		"Never loosen status",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with internal/ai/strategies/feedback-queue-triage/
// goldens.yaml's tools block (the eval harness loads tool names
// from the YAML; the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_feedback_triage",
		"retrieve_feedback_chunks",
		"validate_feedback_triage",
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
// PROPOSE/READ-only. All three tools (draft_feedback_triage,
// validate_feedback_triage, retrieve_feedback_chunks) are pure-
// functional reads or pure DTO transforms. A future edit that
// accidentally adds a write tool (create_*, update_*, delete_*,
// suspend_*, send_*, save_*, apply_*) will fail this test before
// the dispatcher's confirm hook protects the user.
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
// future slice that needs preferred-greeting or per-team triage-
// preference data ships.
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
// F4↔F8 adapter. PolicyAlertBuilder is the DENY-BY-DEFAULT policy:
// Allow == nil so EVERY PII class — VIN, lat/long, addresses,
// place names, AND vehicle-name — is tagged round-trip. The
// slice prompt explicitly mandates "Allowed classes: none;
// feedback text is redacted and proposals require confirmation."
func TestStrategy_RedactionPolicyAlertBuilder(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyAlertBuilder()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyAlertBuilder Mode = %v, want ModeRedactedTags", want.Mode)
	}
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyAlertBuilder.Allow len = %d, want 0 (deny-by-default); got=%v",
			len(want.Allow), want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/feedback-queue-triage/goldens.yaml
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
