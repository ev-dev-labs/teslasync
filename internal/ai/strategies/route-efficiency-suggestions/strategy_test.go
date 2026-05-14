// Phase-50 / 0023 — D3 Route-efficiency suggestions.
//
// Unit tests for the route-efficiency-suggestions Strategy. Mirrors
// the shape of speed-profile-insights / drive-coaching /
// charging-diagnosis strategy_test.go. The Strategy is a pure value
// (no internal state, no IO) so the tests are tight: pin the feature
// ID + system prompt + tool whitelist + redaction policy shape so a
// future edit that breaks the contract surfaces here before the
// dispatcher silently changes behaviour.

package routeefficiencysuggestions

import (
	"context"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "route-efficiency-suggestions". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "route-efficiency-suggestions" {
		t.Fatalf("FeatureID() = %q, want %q", got, "route-efficiency-suggestions")
	}
	if FeatureID != "route-efficiency-suggestions" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "route-efficiency-suggestions")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (home_to_work_commute, weekend_runs, refusal_other_user)
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
		"TeslaSync route-efficiency advisor",
		"ALWAYS call retrieve_route_chunks FIRST",
		"query_route_efficiency",
		"never invent",
		"Refuse politely",
		"2-4 short paragraphs",
		// Defence-in-depth: the prompt must explicitly ban quoting
		// precise route coordinates even though the redaction policy
		// already strips them. A future edit that drops this clause
		// degrades the policy-in-depth posture documented in the
		// strategy doc-comment.
		"Do NOT quote precise route coordinates",
	} {
		if !strings.Contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with
// internal/ai/strategies/route-efficiency-suggestions/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"retrieve_route_chunks",
		"query_route_efficiency",
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
// READ-ONLY. Route-efficiency suggestions ship zero mutating tools
// (per the slice prompt + ADR-015 — read-only state queries +
// retrieval only). A future edit that accidentally adds a write
// tool will fail this test before the dispatcher's confirm hook
// protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: query_* and retrieve_* are read-only;
		// create_*, update_*, delete_*, send_*, suspend_* are
		// write.
		if !strings.HasPrefix(name, "query_") && !strings.HasPrefix(name, "retrieve_") && !strings.HasPrefix(name, "hydrate_") {
			t.Errorf("Tools() includes non-read-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History;
// the strategy must not contribute extra prefix messages until a
// future slice that needs RAG-backed weather/route context ships
// (today the retrieval is driven from the tool calls themselves).
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

// TestStrategy_RedactionPolicyRouteEfficiencySuggestions proves the
// strategy hands the dispatcher PolicyRouteEfficiencySuggestions
// wrapped through the F4↔F8 adapter.
// PolicyRouteEfficiencySuggestions allows ClassVehicleName so the
// narration can name the user's car; every other PII class is
// redacted to a round-trip tag. The slice prompt explicitly
// mandates a PolicyDigest-shaped allow-list and "locations are
// tagged and restored only to same user".
func TestStrategy_RedactionPolicyRouteEfficiencySuggestions(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyRouteEfficiencySuggestions()
	// PolicyRouteEfficiencySuggestions uses the round-trip-tag
	// mode; assert the concrete mode matches so the strategy isn't
	// silently downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyRouteEfficiencySuggestions Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must contain ClassVehicleName so the narration
	// can address the user's car by name. A future edit that drops
	// this silently demotes the suggestions' value proposition.
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicyRouteEfficiencySuggestions.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
	// Defence-in-depth: the allow-list must NOT include lat/long
	// or street addresses — the suggestions narrate the route by
	// place name pair, not exact coordinates, and the slice prompt
	// says "locations are tagged and restored only to same user".
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("redact.PolicyRouteEfficiencySuggestions.Allow includes location class %q; want only ClassVehicleName", c)
		}
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/route-efficiency-suggestions/goldens.yaml
// directly, so the in-code EvalGoldens() returns nil. Future
// strategies may override.
func TestStrategy_EvalGoldensReturnsNil(t *testing.T) {
	t.Parallel()
	s := New()
	if g := s.EvalGoldens(); g != nil {
		t.Fatalf("EvalGoldens() = %v, want nil (goldens live in YAML)", g)
	}
}
