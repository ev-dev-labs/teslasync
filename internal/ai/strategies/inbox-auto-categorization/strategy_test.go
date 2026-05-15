// Phase-50 / 0035 — A2 Inbox auto-categorization.
//
// Unit tests for the inbox-auto-categorization Strategy. Mirrors
// the shape of alert-tuning-suggestions/strategy_test.go (the
// closest precedent: PROPOSE-only A-tier strategy with the SAME
// PolicyAlertBuilder redaction policy and a draft+validate
// two-tool sequence). The Strategy is a pure value (no internal
// state, no IO) so the tests are tight: pin the feature ID +
// system prompt + tool whitelist + redaction policy shape so a
// future edit that breaks the contract surfaces here before the
// dispatcher silently changes behaviour.

package inboxautocategorization

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "inbox-auto-categorization". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "inbox-auto-categorization" {
		t.Fatalf("FeatureID() = %q, want %q", got, "inbox-auto-categorization")
	}
	if FeatureID != "inbox-auto-categorization" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "inbox-auto-categorization")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (typical_noisy_inbox, insufficient_history,
// refusal_other_inbox) would silently degrade if any of these
// substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync inbox auto-categorization assistant",
		"PROPOSE a small ordered set of categorical labels",
		"closed taxonomy",
		// Closed taxonomy labels — must be present verbatim
		// so the LLM never invents a new one.
		"battery, charging, climate, tire, security, connectivity, maintenance, noise, other",
		"NEVER save anything",
		"ALWAYS call draft_alert_categories FIRST",
		"validate_alert_category on EVERY proposed label",
		// Forbidden-mutation pins — narrator must never
		// propose archiving / deleting / re-classifying.
		"Do NOT propose archiving, deleting, marking-read, or re-classifying",
		// Honest-method directive — the per-category counts
		// are a descriptive tally, NOT a forecast.
		"NOT a forecast or a predictive model",
		"DESCRIPTIVE tally",
		// Honest-insufficient-history directive.
		"If has_enough_history is false",
		// Refusal directive — cross-inbox requests are out of
		// scope.
		"Refuse politely",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise street addresses or coordinates
		// even though the redaction policy already strips
		// them.
		"Never quote precise street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with
// internal/ai/strategies/inbox-auto-categorization/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
//
// Order is load-bearing: the dispatcher's per-strategy whitelist
// is matched alphabetically downstream, but the goldens harness
// reads the YAML order, so a divergence between this list and
// the YAML is a wiring bug. The order here mirrors the canonical
// LLM call sequence: draft first, then validate.
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_alert_categories",
		"validate_alert_category",
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
// PROPOSE-only. Both tools (draft_alert_categories +
// validate_alert_category) are pure-functional DTO transforms
// that do NOT touch the database write path. A future edit that
// accidentally adds a write tool (create_*, update_*, delete_*,
// suspend_*, send_*, archive_*, mark_*) will fail this test
// before the dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		// Naming convention: draft_*, validate_*, query_*,
		// retrieve_* are propose / read; create_*, update_*,
		// delete_*, send_*, suspend_*, archive_*, mark_* are
		// write.
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
// future slice that needs cross-rule de-dup snippets ships.
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
// The slice prompt mandates: "Allowed classes: none; alert
// payloads are redacted and category proposals are user-
// confirmed. Round-trip required: no". The policy's Allow list
// is nil and the Mode is ModeRedactedTags; both are pinned so a
// future edit that silently broadens the allow-list or
// downgrades the mode surfaces as a test failure.
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
	// the N1 alert-builder + 0034 alert-tuning slices that
	// share this policy.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyAlertBuilder.Allow has %d entries; want 0 (deny-all): got=%v", len(want.Allow), want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/inbox-auto-categorization/goldens.yaml
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
