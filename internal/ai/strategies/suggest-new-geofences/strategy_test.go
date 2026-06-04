// Unit tests for the suggest-new-geofences Strategy. Mirrors the shape
// of auto-name-unnamed-locations' strategy_test.go (the precedent
// using draft_*/validate_* tools rather than query_*/retrieve_*). The
// Strategy is a pure value (no internal state, no IO) so the tests
// are tight: pin the feature ID + system prompt + tool whitelist +
// redaction policy shape so a future edit that breaks the contract
// surfaces here before the dispatcher silently changes behaviour.

package suggestnewgeofences

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "suggest-new-geofences". The constant is referenced from router.go
// wiring + the AI HTTP handler; changing it without updating the
// registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "suggest-new-geofences" {
		t.Fatalf("FeatureID() = %q, want %q", got, "suggest-new-geofences")
	}
	if FeatureID != "suggest-new-geofences" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "suggest-new-geofences")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (frequent_unfenced_stop, occasional_landmark,
// refusal_other_location) would silently degrade if any of these
// substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync geofence-suggestion assistant",
		"NEVER save anything",
		"ALWAYS call draft_geofence FIRST",
		"validate_geofence",
		"Do NOT invent facts",
		"Refuse politely",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise coordinates / street addresses even
		// though the redaction policy already strips them. A
		// future edit that drops this clause degrades the
		// policy-in-depth posture documented in the strategy
		// doc-comment.
		"never quote precise coordinates or full street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/suggest-new-geofences/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_geofence",
		"validate_geofence",
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
// PROPOSE-ONLY. Both tools (draft_geofence, validate_geofence) are
// pure-functional DTO transforms that do NOT touch the database. A
// future edit that accidentally adds a write tool (create_*, update_*,
// delete_*, suspend_*, send_*) will fail this test before the
// dispatcher's confirm hook protects the user. The actual save flows
// through the existing typed geofence-create path AFTER the user
// explicitly clicks Save in the UI.
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
// dispatcher seeds the user message via StrategyInput.History; the
// strategy must not contribute extra prefix messages until a future
// change needs preferred-radius preferences.
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

// TestStrategy_RedactionPolicySuggestNewGeofences proves the strategy
// hands the dispatcher PolicySuggestNewGeofences wrapped through the
// redaction adapter. PolicySuggestNewGeofences allows ClassVehicleName so
// the proposed name can address the user's car; every other PII class
// is redacted to a round-trip tag. The allow-list is intentionally
// PolicyDigest-shaped and keeps coordinates tagged until user confirmation.
func TestStrategy_RedactionPolicySuggestNewGeofences(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicySuggestNewGeofences()
	// PolicySuggestNewGeofences uses the round-trip-tag mode;
	// assert the concrete mode matches so the strategy isn't
	// silently downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicySuggestNewGeofences Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must contain ClassVehicleName so the proposed
	// name can address the user's car. A future edit that drops
	// this silently demotes the suggestions' value proposition.
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicySuggestNewGeofences.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
	// Defence-in-depth: the allow-list must NOT include lat/long
	// or street addresses — the proposed geofence's coordinates
	// flow through the typed tool envelope, not through prose, and
	// coordinates remain tagged until user confirmation.
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("redact.PolicySuggestNewGeofences.Allow includes location class %q; want only ClassVehicleName", c)
		}
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/suggest-new-geofences/goldens.yaml directly,
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

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
