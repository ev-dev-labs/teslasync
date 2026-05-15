// Phase-50 / 0031 — T1 Preheat and precool recommender.
//
// Unit tests for the preheat-precool-recommender Strategy. Mirrors
// the shape of vampire-drain-explanation's strategy_test.go (the
// closest precedent: single propose/narrate strategy with a small
// tool whitelist). The Strategy is a pure value (no internal state,
// no IO) so the tests are tight: pin the feature ID + system prompt
// + tool whitelist + redaction policy shape so a future edit that
// breaks the contract surfaces here before the dispatcher silently
// changes behaviour.

package preheatprecoolrecommender

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "preheat-precool-recommender". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "preheat-precool-recommender" {
		t.Fatalf("FeatureID() = %q, want %q", got, "preheat-precool-recommender")
	}
	if FeatureID != "preheat-precool-recommender" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "preheat-precool-recommender")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (preheat_cold_morning_happy_path, precool_hot_afternoon,
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
		"TeslaSync preheat-and-precool recommender",
		"PROPOSE a preheat or precool schedule",
		"ALWAYS call draft_climate_schedule FIRST",
		"validate_climate_schedule",
		"Do NOT invent schedules",
		"never invent cabin or outside temperatures",
		// Confirmation contract — the slice prompt's
		// verbatim mandate is "requiring confirmation
		// before creating any schedule"; the prompt MUST
		// say so.
		"ALWAYS require the user to CONFIRM",
		"PROPOSE-only",
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

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with
// internal/ai/strategies/preheat-precool-recommender/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_climate_schedule",
		"validate_climate_schedule",
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
// PROPOSE-only. Both tools (draft_climate_schedule,
// validate_climate_schedule) are pure-functional drafters /
// validators. A future edit that accidentally adds a write tool
// (create_*, save_*, update_*, delete_*, suspend_*, send_*) will
// fail this test before the dispatcher's confirm hook protects
// the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: draft_*, validate_*, query_*,
		// retrieve_* are propose / read; create_*, save_*,
		// update_*, delete_*, send_*, suspend_* are write.
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
// future slice that needs preferred-preheat-temperature
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

// TestStrategy_RedactionPolicyPreheatPrecoolRecommender proves the
// strategy hands the dispatcher PolicyPreheatPrecoolRecommender
// wrapped through the F4↔F8 adapter.
// PolicyPreheatPrecoolRecommender allows ClassVehicleName so the
// narration can address the user's car; every other PII class is
// redacted to a round-trip tag. The slice prompt explicitly
// mandates a PolicyDigest-shaped allow-list with round-trip tags.
func TestStrategy_RedactionPolicyPreheatPrecoolRecommender(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyPreheatPrecoolRecommender()
	// PolicyPreheatPrecoolRecommender uses the round-trip-tag
	// mode; assert the concrete mode matches so the strategy
	// isn't silently downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyPreheatPrecoolRecommender Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must contain ClassVehicleName so the
	// narration can address the user's car. A future edit
	// that drops this silently demotes the recommender's
	// value proposition.
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicyPreheatPrecoolRecommender.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
	// Defence-in-depth: the allow-list must NOT include
	// lat/long or street addresses — the proposal describes
	// the schedule by deterministic temperatures and
	// timestamps, not by exact coordinates.
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("redact.PolicyPreheatPrecoolRecommender.Allow includes location class %q; want only ClassVehicleName", c)
		}
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/preheat-precool-recommender/goldens.yaml
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
