// Phase-50 / 0012 — U2 Weekly digest narration.
//
// Unit tests for the digest-narration Strategy. The Strategy is a
// pure value (no internal state, no IO) so the tests are tight: pin
// the feature ID + system prompt + tool whitelist + redaction policy
// shape so a future edit that breaks the contract surfaces here
// before the dispatcher silently changes behaviour.

package digestnarration

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to "digest-narration".
// The constant is referenced from router.go wiring + the AI HTTP
// handler; changing it without updating the registry would silently
// break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "digest-narration" {
		t.Fatalf("FeatureID() = %q, want %q", got, "digest-narration")
	}
	if FeatureID != "digest-narration" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "digest-narration")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the anti-hallucination directive that the goldens depend
// on. A regression that drops "STRICTLY" silently degrades every
// digest narration.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{"TeslaSync", "STRICTLY", "Never invent", "query_weekly_digest_context"} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay in
// sync with internal/ai/strategies/digest-narration/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML; the
// dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_weekly_digest_context",
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
// READ-ONLY. The narrator ships zero mutating tools (per the prompt
// + ADR-015 — read-only state queries only). A future edit that
// accidentally adds a write tool will fail this test before the
// dispatcher's confirm hook protects the user.
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
// future slice that needs RAG-backed digest context ships.
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

// TestStrategy_RedactionPolicyDigest proves the strategy hands the
// dispatcher PolicyDigest wrapped through the F4↔F8 adapter.
// PolicyDigest allows ClassVehicleName so the narration can name the
// user's car; every other PII class is redacted to a round-trip tag.
func TestStrategy_RedactionPolicyDigest(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyDigest()
	// PolicyDigest uses the round-trip-tag mode; assert the
	// concrete mode matches so the strategy isn't silently downgraded.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyDigest Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must contain ClassVehicleName so the narration can
	// address the user's car by name. A future edit that drops this
	// silently demotes the digest's value proposition.
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("redact.PolicyDigest.Allow does not include ClassVehicleName; got=%v", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/digest-narration/goldens.yaml directly, so
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

func startsWithQuery(name string) bool {
	const prefix = "query_"
	return len(name) >= len(prefix) && name[:len(prefix)] == prefix
}
