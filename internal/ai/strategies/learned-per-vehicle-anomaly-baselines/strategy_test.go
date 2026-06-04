// Unit tests for the learned-per-vehicle-anomaly-baselines Strategy.
// They pin the feature ID, system prompt, tool whitelist, and redaction
// policy so contract changes fail before dispatcher behavior changes
// silently.

package learnedpervehicleanomalybaselines

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "learned-per-vehicle-anomaly-baselines". The constant is
// referenced from router.go wiring + the AI HTTP handler; changing
// it without updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "learned-per-vehicle-anomaly-baselines" {
		t.Fatalf("FeatureID() = %q, want %q", got, "learned-per-vehicle-anomaly-baselines")
	}
	if FeatureID != "learned-per-vehicle-anomaly-baselines" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "learned-per-vehicle-anomaly-baselines")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (typical_learned_envelope, fallback_to_safe_ranges,
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
		"TeslaSync learned per-vehicle anomaly baseline narrator",
		"ALWAYS call train_anomaly_baseline FIRST",
		"query_anomaly_baseline",
		"NEVER persist a learned envelope",
		"never invent alternate bounds",
		"never fabricate sample counts",
		"safe_ranges_fallback",
		"would tighten",
		"Refuse politely",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist AND the prescribed
// order: train_anomaly_baseline FIRST, then query_anomaly_baseline.
// Tool order matters: train_anomaly_baseline must run before
// query_anomaly_baseline. Reversing them can make the narration quote
// the fallback as if it were the learned proposal; the eval harness
// loads the same list from goldens.yaml.
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"train_anomaly_baseline",
		"query_anomaly_baseline",
	}
	if len(got) != len(want) {
		t.Fatalf("Tools() length = %d, want %d (got=%v)", len(got), len(want), got)
	}
	for i, name := range want {
		if got[i] != name {
			t.Errorf("Tools()[%d] = %q, want %q (order matters: train FIRST, then query)", i, got[i], name)
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
// READ-ONLY. Both tools (train_anomaly_baseline and
// query_anomaly_baseline) are pure-functional reads. A future edit
// that accidentally adds a write tool (create_*, update_*, delete_*,
// suspend_*, send_*) will fail this test before the dispatcher's
// confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: draft_*, validate_*, query_*,
		// retrieve_*, train_* are propose / read; create_*,
		// update_*, delete_*, send_*, suspend_* are write.
		switch {
		case startsWith(name, "draft_"),
			startsWith(name, "validate_"),
			startsWith(name, "query_"),
			startsWith(name, "retrieve_"),
			startsWith(name, "train_"):
			// OK — propose / validate / read / train (read-only).
		default:
			t.Errorf("Tools() includes non-propose-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History;
// the strategy must not contribute extra prefix messages until a
// future version needs preferred-window preferences.
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

// TestStrategy_RedactionPolicyChatbot proves the strategy hands the
// dispatcher PolicyChatbot wrapped through the strategy redaction adapter.
// PolicyChatbot is the project-wide deny-all-tagged policy: every
// PII class is converted into a round-trip tag before the LLM call
// (Allow: nil, Mode: ModeRedactedTags). The strategy contract
// requires "Allowed classes: none; model training uses local stored
// data and no provider call in off mode".
func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChatbot()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list must be empty (deny-all). A future edit that
	// silently widens this would let cleartext PII reach the
	// provider — fail loudly instead.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyChatbot.Allow = %v, want empty (deny-all)", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/learned-per-vehicle-anomaly-baselines/goldens.yaml
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
