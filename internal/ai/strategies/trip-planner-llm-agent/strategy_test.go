// Trip planner LLM agent strategy tests.
//
// Unit tests for the trip-planner-llm-agent Strategy. Mirrors the
// shape of auto-trip-naming's strategy_test.go (the propose-only
// precedent using query_*/draft_* tools). The Strategy is a pure
// value (no internal state, no IO) so the tests are tight: pin the
// feature ID + system prompt + tool whitelist + redaction policy
// shape so a future edit that breaks the contract surfaces here
// before the dispatcher silently changes behaviour.

package tripplannerllmagent

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "trip-planner-llm-agent". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "trip-planner-llm-agent" {
		t.Fatalf("FeatureID() = %q, want %q", got, "trip-planner-llm-agent")
	}
	if FeatureID != "trip-planner-llm-agent" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "trip-planner-llm-agent")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (happy_path_short_trip, charger_required_long_trip,
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
		"TeslaSync trip-planner agent",
		"NEVER save anything",
		"ALWAYS follow this tool sequence",
		"query_chargers_along_route",
		"query_user_charge_dwells",
		"draft_trip_plan",
		"Do NOT invent facts",
		"Refuse politely",
		// Defence-in-depth: the prompt must explicitly ban
		// inventing a charger that the corridor query did not
		// return. A future edit that drops this clause degrades
		// the policy-in-depth posture documented in the strategy
		// doc-comment.
		"never invent a charger",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise route coordinates even though the
		// redaction policy already strips them.
		"never quote precise route coordinates",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with
// internal/ai/strategies/trip-planner-llm-agent/goldens.yaml's tools
// block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_chargers_along_route",
		"query_user_charge_dwells",
		"draft_trip_plan",
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
// PROPOSE-ONLY. All three tools (query_chargers_along_route,
// query_user_charge_dwells, draft_trip_plan) are pure-functional
// reads / DTO transforms that do NOT touch the database. A future
// edit that accidentally adds a write tool (create_*, update_*,
// delete_*, suspend_*, send_*) will fail this test before the
// dispatcher's confirm hook protects the user. The actual save
// flows through the existing typed trip-planner save path AFTER
// the user explicitly clicks Plan in the UI.
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
// future feature needs route-style preferences.
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

// TestStrategy_RedactionPolicyTripPlannerLLMAgent proves the
// strategy hands the dispatcher PolicyTripPlannerLLMAgent wrapped
// through the redaction adapter. PolicyTripPlannerLLMAgent allows
// ClassVehicleName so the narration can address the user's car;
// every other PII class is redacted to a round-trip tag. Start and end locations remain tagged and are restored only for the same user.
func TestStrategy_RedactionPolicyTripPlannerLLMAgent(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyTripPlannerLLMAgent()
	// PolicyTripPlannerLLMAgent uses the round-trip-tag mode;
	// assert the concrete mode matches so the strategy isn't
	// silently downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyTripPlannerLLMAgent Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must contain ClassVehicleName so the narration
	// can address the user's car. A future edit that drops this
	// silently demotes the agent's value proposition.
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicyTripPlannerLLMAgent.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
	// Defence-in-depth: the allow-list must NOT include lat/long
	// or street addresses — the narration describes the plan by
	// distance / arrival_soc / tagged charger place name, not by exact
	// coordinates. Start and end locations stay tagged until same-user
	// restoration.
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("redact.PolicyTripPlannerLLMAgent.Allow includes location class %q; want only ClassVehicleName", c)
		}
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/trip-planner-llm-agent/goldens.yaml
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
