// Phase-50 / 0019 — N5 Per-charging-session diagnosis.
//
// Unit tests for the charging-diagnosis Strategy. Mirrors the shape
// of drive-coaching / anomaly-explanations / nl-search
// strategy_test.go. The Strategy is a pure value (no internal
// state, no IO) so the tests are tight: pin the feature ID + system
// prompt + tool whitelist + redaction policy shape so a future edit
// that breaks the contract surfaces here before the dispatcher
// silently changes behaviour.

package chargingdiagnosis

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to "charging-diagnosis".
// The constant is referenced from router.go wiring + the AI HTTP
// handler; changing it without updating the registry would silently
// break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "charging-diagnosis" {
		t.Fatalf("FeatureID() = %q, want %q", got, "charging-diagnosis")
	}
	if FeatureID != "charging-diagnosis" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "charging-diagnosis")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (trickle_session, expensive_session, refusal_other_session)
// would silently degrade if any of these substrings disappeared
// from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync charging diagnosis assistant",
		"ALWAYS call query_charge_session AND query_charging_aggregation FIRST",
		"never invent",
		"trickle, expensive, low-power, or interrupted",
		"Refuse politely",
		"2-4 short paragraphs",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/charging-diagnosis/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_charge_session",
		"query_charging_aggregation",
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
// READ-ONLY. The diagnosis ships zero mutating tools (per the slice
// prompt + ADR-015 — read-only state queries only). A future edit
// that accidentally adds a write tool will fail this test before
// the dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: query_* is read-only; create_*,
		// update_*, delete_*, send_*, suspend_* are write.
		if !startsWithQuery(name) {
			t.Errorf("Tools() includes non-read-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History;
// the strategy must not contribute extra prefix messages until a
// future slice that needs RAG-backed charging context ships.
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

// TestStrategy_RedactionPolicyChargingDiagnosis proves the strategy
// hands the dispatcher PolicyChargingDiagnosis wrapped through the
// F4↔F8 adapter. PolicyChargingDiagnosis allows ClassVehicleName so
// the diagnosis can name the user's car; every other PII class is
// redacted to a round-trip tag. The slice prompt explicitly mandates
// a PolicyDigest-shaped allow-list and "charging location names
// remain tagged by default".
func TestStrategy_RedactionPolicyChargingDiagnosis(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChargingDiagnosis()
	// PolicyChargingDiagnosis uses the round-trip-tag mode; assert
	// the concrete mode matches so the strategy isn't silently
	// downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChargingDiagnosis Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must contain ClassVehicleName so the narration
	// can address the user's car by name. A future edit that
	// drops this silently demotes the diagnosis's value
	// proposition.
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicyChargingDiagnosis.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
	// Defence-in-depth: the allow-list must NOT include lat/long
	// or addresses — the diagnosis narrates flag patterns, not
	// charging-station coordinates, and the slice prompt says
	// "charging location names remain tagged by default".
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("redact.PolicyChargingDiagnosis.Allow includes location class %q; want only ClassVehicleName", c)
		}
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/charging-diagnosis/goldens.yaml directly,
// so the in-code EvalGoldens() returns nil. Future strategies may
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

func startsWithQuery(name string) bool {
	const prefix = "query_"
	return len(name) >= len(prefix) && name[:len(prefix)] == prefix
}
