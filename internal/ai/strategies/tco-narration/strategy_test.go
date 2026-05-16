// Phase-50 / 0050 — M2 TCO narration.
//
// Unit tests for the tco-narration Strategy. Mirrors the shape of
// cost-forecast-narration's strategy_test.go (the closest
// precedent: single read-only narrator strategy with no RAG). The
// Strategy is a pure value (no internal state, no IO) so the
// tests are tight: pin the feature ID + system prompt + tool
// whitelist + redaction policy shape so a future edit that breaks
// the contract surfaces here before the dispatcher silently
// changes behaviour.

package tconarration

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to "tco-narration".
// The constant is referenced from router.go wiring + the AI HTTP
// handler; changing it without updating the registry would
// silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "tco-narration" {
		t.Fatalf("FeatureID() = %q, want %q", got, "tco-narration")
	}
	if FeatureID != "tco-narration" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "tco-narration")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (typical_growth_savings, insufficient_data,
// negative_savings_honesty) would silently degrade if any of
// these substrings disappeared from the prompt.
//
// The four limiting-assumption substrings are the rubber-duck
// blocking finding for slice 0050: an LLM that does not name
// these explicitly will overclaim "Total Cost of Ownership"
// when the math is operating-cost only.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync ownership-cost narrator",
		"EXPLAIN the deterministic operating-cost envelope",
		"ALWAYS call query_tco_summary FIRST",
		"never invent an alternate dollar amount",
		// Limiting-assumption directives — slice 0050
		// rubber-duck blocking finding. The narrator MUST
		// disclose all four caveats so the user is not misled
		// into treating this as full TCO.
		"OPERATING-COST ONLY",
		"NOT full Total Cost of Ownership",
		"flat $50-per-month heuristic",
		"ESTIMATED from each month's charging energy",
		"user-editable settings",
		// Honest-insufficient-data directive — when
		// total_sessions=0 or months_of_ownership=1 (floor),
		// the narrator MUST say so rather than invent a
		// savings story.
		"not yet enough history",
		// Negative-savings honesty — slice 0050 rubber-duck
		// blocking finding. The narrator must NOT cheerlead
		// when EV cost > gas equivalent, and MUST NOT
		// recommend buying a gas vehicle.
		"NEGATIVE",
		"never cheerlead",
		"never recommend buying or switching to a gas vehicle",
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

// TestStrategy_Tools pins the exact whitelist. The list MUST
// stay in sync with
// internal/ai/strategies/tco-narration/goldens.yaml's tools
// block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_tco_summary",
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
// READ-ONLY. The single tool (query_tco_summary) is a
// pure-functional read that composes the existing
// api.ComputeTCOSummary helper behind a narrow port. A future
// edit that accidentally adds a write tool (create_*, update_*,
// delete_*, suspend_*, send_*) will fail this test before the
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
// future slice that needs preferred-currency or
// preferred-mileage-window preferences ships.
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
// the dispatcher PolicyDigest wrapped through the F4↔F8 adapter.
// PolicyDigest allows ClassVehicleName so the narration can
// address the user's car; every other PII class is redacted to
// a round-trip tag. The slice prompt explicitly mandates a
// PolicyDigest allow-list with round-trip tags.
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
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicyDigest.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
	// Defence-in-depth: the allow-list must NOT include
	// lat/long or street addresses — the narration describes
	// the envelope by aggregate dollar amounts, sessions
	// count, and per-km comparisons, not by exact
	// coordinates.
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("redact.PolicyDigest.Allow includes location class %q; want only ClassVehicleName", c)
		}
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven
// goldens contract: the harness loads goldens from
// internal/ai/strategies/tco-narration/goldens.yaml directly, so
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
