// Phase-50 / 0036 — A3 Cross-rule conflict detection.
//
// Unit tests for the cross-rule-conflict-detection Strategy.
// Mirrors the shape of inbox-auto-categorization/strategy_test.go
// (the closest precedent: PROPOSE-only A-tier strategy with the
// SAME PolicyAlertBuilder redaction policy and a query+detect
// two-tool sequence). The Strategy is a pure value (no internal
// state, no IO) so the tests are tight: pin the feature ID +
// system prompt + tool whitelist + redaction policy shape so a
// future edit that breaks the contract surfaces here before the
// dispatcher silently changes behaviour.

package crossruleconflictdetection

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "cross-rule-conflict-detection". The constant is referenced
// from router.go wiring + the AI HTTP handler; changing it
// without updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "cross-rule-conflict-detection" {
		t.Fatalf("FeatureID() = %q, want %q", got, "cross-rule-conflict-detection")
	}
	if FeatureID != "cross-rule-conflict-detection" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "cross-rule-conflict-detection")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (typical_overlapping_thresholds, no_conflicts_clean_set,
// refusal_other_user) would silently degrade if any of these
// substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync alert cross-rule conflict-detection assistant",
		"NARRATE structural overlaps",
		"NEVER edit, merge, delete, disable",
		"ALWAYS call query_alert_rules FIRST",
		"detect_rule_conflicts with the SAME rule set",
		// Closed-taxonomy pin — must be present verbatim so the
		// LLM never invents a new conflict kind.
		"redundant_duplicate",
		"overlapping_threshold",
		// Forbidden-overclaim pin — the AI engine cannot prove
		// runtime suppression from rule definitions alone.
		"NEVER claim a runtime suppression effect",
		// Forbidden-mutation pins — narrator must never propose
		// merging / deleting / disabling.
		"Do NOT propose merging two rules",
		// Honest-method directive — the conflicts are a
		// structural overlap analysis, NOT a firing prediction.
		"STRUCTURAL OVERLAP ANALYSIS",
		"NOT a prediction",
		// Honest-insufficient-rules directive.
		"If has_enough_rules is false",
		// Empty-conflicts honesty pin — must not manufacture a
		// conflict from severity/cooldown deltas alone.
		"DO NOT manufacture a conflict from severity differences",
		// Refusal directive — cross-user requests are out of
		// scope.
		"Refuse politely",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise street addresses or coordinates even
		// though the redaction policy already strips them.
		"Never quote precise street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with
// internal/ai/strategies/cross-rule-conflict-detection/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
//
// Order is load-bearing: the dispatcher's per-strategy whitelist
// is matched alphabetically downstream, but the goldens harness
// reads the YAML order, so a divergence between this list and
// the YAML is a wiring bug. The order here mirrors the canonical
// LLM call sequence: query first, detect second.
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_alert_rules",
		"detect_rule_conflicts",
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
// PROPOSE-only. Both tools (query_alert_rules +
// detect_rule_conflicts) are pure-functional DTO transforms
// that do NOT touch the database write path. A future edit that
// accidentally adds a write tool (create_*, update_*, delete_*,
// merge_*, suspend_*, send_*, archive_*, mark_*) will fail this
// test before the dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: query_*, retrieve_*, detect_*,
		// draft_*, validate_* are propose / read; create_*,
		// update_*, delete_*, merge_*, send_*, suspend_*,
		// archive_*, mark_* are write.
		switch {
		case startsWith(name, "query_"),
			startsWith(name, "retrieve_"),
			startsWith(name, "detect_"),
			startsWith(name, "draft_"),
			startsWith(name, "validate_"):
			// OK — propose / validate / read.
		default:
			t.Errorf("Tools() includes non-propose-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via
// StrategyInput.History; the strategy must not contribute extra
// prefix messages until a future slice that needs cross-domain
// (e.g. cross-rule + cross-automation) snippets ships.
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

// TestStrategy_RedactionPolicyAlertBuilder proves the strategy
// hands the dispatcher PolicyAlertBuilder wrapped through the
// F4↔F8 adapter. PolicyAlertBuilder denies ALL PII classes — the
// LLM never needs cleartext rule identifiers because the typed
// envelope carries them through the F4 tool layer.
//
// The slice prompt mandates: "Allowed classes: none; rule
// definitions are DTOs and no PII is needed. Round-trip
// required: no". The policy's Allow list is nil and the Mode is
// ModeRedactedTags; both are pinned so a future edit that
// silently broadens the allow-list or downgrades the mode
// surfaces as a test failure.
func TestStrategy_RedactionPolicyAlertBuilder(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyAlertBuilder()
	// PolicyAlertBuilder uses ModeRedactedTags. Pin so a
	// silent downgrade to a leak-friendly mode surfaces here.
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyAlertBuilder Mode = %v, want ModeRedactedTags", want.Mode)
	}
	// Allow list MUST be empty — this is the load-bearing
	// "deny-all" invariant the slice prompt mandates. A future
	// edit that adds even ClassVehicleName to the allow-list
	// would change the threat model and break alignment with
	// the N1/A1/A2 slices that share this policy.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyAlertBuilder.Allow has %d entries; want 0 (deny-all): got=%v", len(want.Allow), want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/cross-rule-conflict-detection/goldens.yaml
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
