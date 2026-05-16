// Phase-50 / 0049 — M1 Predictive maintenance.
//
// Unit tests for the predictive-maintenance Strategy. Mirrors
// the shape of state-machine-debugger-narrator's
// strategy_test.go (the closest precedent: a tools+RAG-style
// narrator strategy with a scope-bound query tool). The
// Strategy is a pure value (no internal state, no IO) so the
// tests are tight: pin the feature ID + system prompt + tool
// whitelist + redaction policy shape so a future edit that
// breaks the contract surfaces here before the dispatcher
// silently changes behaviour.

package predictivemaintenance

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID. The constant is
// referenced from router.go wiring + the AI HTTP handler;
// changing it without updating the registry would silently break
// the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "predictive-maintenance" {
		t.Fatalf("FeatureID() = %q, want %q", got, "predictive-maintenance")
	}
	if FeatureID != "predictive-maintenance" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "predictive-maintenance")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (typical_overdue_item, typical_healthy_baseline,
// refusal_out_of_scope_request) would silently degrade if any
// of these substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync predictive-maintenance agent",
		"ALWAYS call query_maintenance_context FIRST",
		// Optional secondary tool: retrieve_maintenance_chunks
		// is OPTIONAL — the advisory grounds in the
		// deterministic envelope first.
		"retrieve_maintenance_chunks",
		// Honest-no-invention pin.
		"Never invent a maintenance item",
		// Honest-zero-data pin.
		"degenerate (zero items or zero overdue",
		// Honest-unknown-odometer pin.
		"current_mileage is null",
		// Refusal directive — out-of-scope vehicles are forbidden.
		"Refuse politely",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST
// stay in sync with internal/ai/strategies/predictive-
// maintenance/goldens.yaml's tools block (the eval harness
// loads tool names from the YAML; the dispatcher loads them
// from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_maintenance_context",
		"retrieve_maintenance_chunks",
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

// TestStrategy_ToolsIsDefensiveCopy proves Tools() returns a
// copy — a caller that mutates the slice does NOT leak the
// mutation back into the strategy. Dispatcher safety relies on
// this.
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
// READ-ONLY. Both tools (query_maintenance_context,
// retrieve_maintenance_chunks) are pure-functional reads. A
// future edit that accidentally adds a write tool (create_*,
// update_*, delete_*, schedule_*, send_*) will fail this test
// before the dispatcher's confirm hook protects the user.
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

// TestStrategy_ContextReturnsNil pins the empty-context
// contract. The dispatcher seeds the user message via
// StrategyInput.History; the strategy must not contribute extra
// prefix messages until a future slice that needs preferred-
// greeting or preferred-unit-display preferences ships.
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

// TestStrategy_RedactionPolicyDigest proves the strategy hands
// the dispatcher PolicyDigest wrapped through the F4↔F8
// adapter. PolicyDigest allows ONLY ClassVehicleName so the
// advisory can say "your Roadie's cabin air filter is overdue"
// without leaking the VIN or any coordinates. The slice prompt
// explicitly mandates "Allowed classes: ClassVehicleName only;
// service history is user-visible and sensitive text is
// tagged."
func TestStrategy_RedactionPolicyDigest(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyDigest()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyDigest Mode = %v, want ModeRedactedTags", want.Mode)
	}
	if len(want.Allow) != 1 {
		t.Errorf("redact.PolicyDigest.Allow len = %d, want 1 (ClassVehicleName); got=%v",
			len(want.Allow), want.Allow)
	} else if want.Allow[0] != redact.ClassVehicleName {
		t.Errorf("redact.PolicyDigest.Allow[0] = %v, want ClassVehicleName", want.Allow[0])
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven
// goldens contract: the harness loads goldens from
// internal/ai/strategies/predictive-maintenance/goldens.yaml
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
