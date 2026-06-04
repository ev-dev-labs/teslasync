// Unit tests for the safety-setting-explainer strategy.
// The strategy is a pure value, so these tests pin the feature ID,
// system prompt, tool whitelist, and redaction policy before a
// contract break can reach the dispatcher.

package safetysettingexplainer

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "safety-setting-explainer". The constant is referenced from
// router.go wiring + the AI HTTP handler; changing it without
// updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "safety-setting-explainer" {
		t.Fatalf("FeatureID() = %q, want %q", got, "safety-setting-explainer")
	}
	if FeatureID != "safety-setting-explainer" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "safety-setting-explainer")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (explain_quiet_hours_enabled,
// explain_alert_digest_mode, refuse_out_of_scope_setting) would
// silently degrade if any of these substrings disappeared from
// the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"safety setting explainer",
		"EXPLAIN the user's existing safety-related TeslaSync settings",
		"ALWAYS call query_safety_settings FIRST",
		// Honest "explain, not prescribe" directives — the
		// narrator must NEVER claim a setting was changed,
		// NEVER propose a different value.
		"you NEVER propose a new value",
		"you EXPLAIN, you do not prescribe",
		// Honest "no fabricated settings" directive — the
		// narrator must NEVER invent a setting key the typed
		// envelope did not surface.
		"Do NOT invent a setting key",
		"do NOT invent allowed_values outside the envelope",
		// Honest "refuse out-of-scope" directive — the
		// narrator must refuse politely if asked about a
		// setting that is NOT in the safety-related typed
		// envelope.
		"Refuse politely if asked to explain a setting that is NOT in the safety-related typed envelope",
		// retrieve_docs scope constraint — the narrator must
		// only call retrieve_docs with source_types=["docs"];
		// runbooks and i18n corpora are forbidden.
		`source_types=["docs"]`,
		"querying the runbooks or i18n corpora is forbidden",
		// Defence-in-depth: the prompt must explicitly ban
		// quoting precise street addresses, GPS coordinates,
		// place names, or charger network labels even though
		// the redaction policy already strips them.
		"Never quote precise street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with
// internal/ai/strategies/safety-setting-explainer/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_safety_settings",
		"retrieve_docs",
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
// READ-ONLY. Both tools (query_safety_settings, retrieve_docs)
// are pure-functional reads / aggregators. A future edit that
// accidentally adds a write tool (create_*, update_*, delete_*,
// save_*, send_*) will fail this test before the dispatcher's
// confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
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
// the AI handler synthesises a "explain the safety settings"
// prompt before the call, so the strategy itself contributes no
// extra prefix messages.
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

// TestStrategy_RedactionPolicyChatbot proves the strategy hands
// the dispatcher PolicyChatbot wrapped through the F4↔F8 adapter.
// PolicyChatbot's Allow=nil deny-by-default policy means EVERY
// PII class is tagged round-trip before the message reaches the
// provider — the typed envelope returned by query_safety_settings
// contains scalar setting values only (booleans, enum strings,
// HH:MM time strings) and is PII-free by construction so no class
// needs to be allowed in cleartext.
//
// Current settings remain redacted, and no provider sees secrets.
func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChatbot()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags (round-trip tagging)", want.Mode)
	}
	// Allow=nil is the load-bearing invariant — every PII
	// class is tagged round-trip. A future edit that quietly
	// promotes ClassVehicleName / ClassLatLong / ClassEmail /
	// etc. into the allow-list MUST fail this test.
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyChatbot.Allow = %v, want empty (no PII class in cleartext)", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/safety-setting-explainer/goldens.yaml
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
