// Phase-50 / 0051 — M3 Software update changelog summarizer.
//
// Unit tests for the software-update-changelog-summarizer
// Strategy. Mirrors the shape of tco-narration's strategy_test.go
// (the closest precedent). The Strategy is a pure value (no
// internal state, no IO) so the tests are tight: pin the feature
// ID + system prompt + tool whitelist + redaction policy shape so
// a future edit that breaks the contract surfaces here before
// the dispatcher silently changes behaviour.

package softwareupdatechangelogsummarizer

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "software-update-changelog-summarizer". The constant is
// referenced from router.go wiring + the AI HTTP handler;
// changing it without updating the registry would silently break
// the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "software-update-changelog-summarizer" {
		t.Fatalf("FeatureID() = %q, want %q", got, "software-update-changelog-summarizer")
	}
	if FeatureID != "software-update-changelog-summarizer" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "software-update-changelog-summarizer")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on.
// The goldens (typical_recent_install, no_release_notes_honesty,
// no_install_history_honesty) would silently degrade if any of
// these substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"firmware-update changelog summarizer",
		"SUMMARIZE the deterministic firmware update history",
		"ALWAYS call query_vehicle_software FIRST",
		"NEVER invent a version number",
		"NEVER invent a feature/fix",
		"NEVER speculate about Tesla's roadmap",
		// OPTIONAL retrieve_update_notes directive — the
		// strategy's two-tool contract requires the LLM to
		// know it MAY (not MUST) reach for the F7 corpus.
		"OPTIONALLY call retrieve_update_notes",
		// Honest "no notes available" disclosure — slice 0051
		// load-bearing directive. The narrator MUST NOT
		// fabricate release-note content when the corpus is
		// empty for a listed version.
		"the release-note text for version X is not in the cached corpus",
		// Honest "no installs yet" disclosure — when the
		// deterministic envelope reports total_updates=0 the
		// narrator MUST say so plainly.
		"vehicle has no firmware history yet",
		// Refusal directive — cross-vehicle requests are out
		// of scope.
		"Refuse politely",
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

// TestStrategy_Tools pins the exact whitelist. The list MUST
// stay in sync with
// internal/ai/strategies/software-update-changelog-summarizer/
// goldens.yaml's tools block (the eval harness loads tool names
// from the YAML; the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"query_vehicle_software",
		"retrieve_update_notes",
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
// READ-ONLY. Both tools (query_vehicle_software,
// retrieve_update_notes) are pure-functional reads. A future edit
// that accidentally adds a write tool (create_*, update_*,
// delete_*, suspend_*, send_*) will fail this test before the
// dispatcher's confirm hook protects the user.
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
// the strategy must not contribute extra prefix messages until a
// future slice that needs preferred-locale or
// preferred-firmware-channel preferences ships.
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
// PolicyChatbot's Allow=nil deny-by-default policy means EVERY PII
// class (including vehicle name) is tagged round-trip before the
// message reaches the provider — release-note text is public so
// no class needs to be allowed in cleartext.
//
// The slice prompt explicitly mandates:
//
//	"Policy:              PolicyChatbot from internal/ai/redact/policies.go
//	 Allowed classes:     none; release notes are public text and vehicle
//	                      identifiers stay tagged
//	 Round-trip required: yes"
func TestStrategy_RedactionPolicyChatbot(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyChatbot()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyChatbot Mode = %v, want ModeRedactedTags (round-trip required)", want.Mode)
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
// internal/ai/strategies/software-update-changelog-summarizer/
// goldens.yaml directly, so the in-code EvalGoldens() returns nil.
// Future strategies may override.
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
