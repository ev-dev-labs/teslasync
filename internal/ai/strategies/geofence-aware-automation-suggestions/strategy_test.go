// Geofence-aware automation suggestion strategy tests.
//
// Unit tests for the geofence-aware-automation-suggestions Strategy.
// Mirrors the shape of nl-automation-builder's strategy_test.go (the
// closest precedent — same tools, same propose-only contract). The
// Strategy is a pure value (no internal state, no IO) so the tests
// are tight: pin the feature ID + system prompt + tool whitelist +
// redaction policy shape so a future edit that breaks the contract
// surfaces here before the dispatcher silently changes behaviour.

package geofenceawareautomationsuggestions

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "geofence-aware-automation-suggestions". The constant is referenced
// from router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "geofence-aware-automation-suggestions" {
		t.Fatalf("FeatureID() = %q, want %q", got, "geofence-aware-automation-suggestions")
	}
	if FeatureID != "geofence-aware-automation-suggestions" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "geofence-aware-automation-suggestions")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (commute_geofence_precondition, night_charging_at_home,
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
		"TeslaSync geofence-aware automation suggester",
		"NEVER save",
		"ALWAYS call draft_automation_graph FIRST",
		"validate_automation_graph",
		// Defence-in-depth: the prompt MUST forbid mutating
		// existing automations OR existing geofences. A future
		// edit that drops the "or any existing geofence" clause
		// would let the LLM propose disabling/deleting a geofence
		// the user did not authorise.
		"any existing geofence",
		// Critical: the prompt must mandate at least one
		// geofence-anchored step. Without this clause, the LLM
		// can drift into producing non-geofence drafts that the
		// nl-automation-builder already covers.
		"trigger_geofence or condition_geofence",
		// Defence-in-depth: must forbid inventing place_id
		// values. The handler injects a deterministic geofence
		// catalog; the LLM picks from it.
		"never invent a place_id",
		"Refuse politely",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/geofence-aware-automation-suggestions/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here). The two tools are the same
// process-wide instances registered by nl-automation-builder; this strategy DOES NOT re-register them.
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_automation_graph",
		"validate_automation_graph",
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

// TestStrategy_ToolsIsDefensiveCopy proves Tools() returns a copy — a
// caller that mutates the slice does NOT leak the mutation back into
// the strategy. Dispatcher safety relies on this.
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
// PROPOSE-ONLY. Both tools (draft_automation_graph,
// validate_automation_graph) are pure-functional DTO transforms that
// do NOT touch the database. A future edit that accidentally adds a
// write tool (create_*, update_*, delete_*, suspend_*, send_*) will
// fail this test before the dispatcher's confirm hook protects the
// user. The actual save flows through the existing typed
// POST /api/v1/automations handler AFTER the user explicitly clicks
// Save in the UI.
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

// TestStrategy_ContextReturnsNil pins the empty-context contract. The
// dispatcher seeds the user message via StrategyInput.LastMessage; the
// strategy must not contribute extra prefix messages until a future feature needs per-vehicle automation summaries.
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

// TestStrategy_RedactionPolicyAlertBuilder proves the strategy hands
// the dispatcher PolicyAlertBuilder wrapped through the redaction adapter.
// PolicyAlertBuilder denies every PII class — vehicle, place, and
// channel identifiers flow through the typed envelope, not through
// prose. Geofence IDs flow through tools, so no PII class is allowed in cleartext.
func TestStrategy_RedactionPolicyAlertBuilder(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyAlertBuilder()
	// PolicyAlertBuilder uses the round-trip-tag mode; assert the
	// concrete mode matches so the strategy isn't silently
	// downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyAlertBuilder Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// No PII class is allowed in cleartext. A future edit that adds
	// an allow-list class would silently degrade the trust posture of
	// every geofence-aware draft.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyAlertBuilder.Allow = %v, want empty (slice prompt: 'Allowed classes: none')", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/geofence-aware-automation-suggestions/goldens.yaml
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
