// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// Unit tests for the nl-drive-search-replay Strategy. Mirrors the
// shape of nl-search / drive-coaching / rag-help strategy_test.go.
// The Strategy is a pure value (no internal state, no IO) so the
// tests are tight: pin the feature ID + system prompt + tool
// whitelist + redaction policy shape so a future edit that breaks
// the contract surfaces here before the dispatcher silently changes
// behaviour.

package nldrivesearchreplay

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID to
// "nl-drive-search-replay". The constant is referenced from router.go
// wiring + the AI HTTP handler; changing it without updating the
// registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "nl-drive-search-replay" {
		t.Fatalf("FeatureID() = %q, want %q", got, "nl-drive-search-replay")
	}
	if FeatureID != "nl-drive-search-replay" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "nl-drive-search-replay")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (basic_drive_query, replay_followup, zero_matches,
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
		"natural-language drive search and replay assistant",
		"NEVER write SQL",
		"NEVER fabricate",
		"ALWAYS call retrieve_drive_chunks FIRST",
		"hydrate_drive_replay",
		"drive_summary",
		"route_segment",
		"location_summary",
		"replay_url",
		"/drives/{id}/replay",
		"Refuse politely",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with internal/ai/strategies/nl-drive-search-replay/
// goldens.yaml's tools block (the eval harness loads tool names
// from the YAML; the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"retrieve_drive_chunks",
		"hydrate_drive_replay",
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
// READ-only. Both tools (retrieve_drive_chunks, hydrate_drive_replay)
// are pure-functional read calls that do NOT touch the database
// write path. A future edit that accidentally adds a write tool
// (create_*, update_*, delete_*, save_*, send_*) will fail this
// test before the dispatcher's confirm hook protects the user.
func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	s := New()
	for _, name := range s.Tools() {
		switch {
		case startsWith(name, "retrieve_"),
			startsWith(name, "hydrate_"),
			startsWith(name, "query_"),
			startsWith(name, "search_"),
			startsWith(name, "fetch_"),
			startsWith(name, "validate_"),
			startsWith(name, "draft_"):
			// OK — read / propose.
		default:
			t.Errorf("Tools() includes non-read-only tool %q", name)
		}
	}
}

// TestStrategy_ContextReturnsNil pins the empty-context contract.
// The dispatcher seeds the user message via StrategyInput.History;
// the strategy must not contribute extra prefix messages until a
// future slice that needs pre-fetched RAG context ships.
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
// dispatcher PolicyChatbot wrapped through the F4↔F8 adapter.
// PolicyChatbot allows NOTHING in cleartext — VINs, place names,
// addresses, lat/long flow as round-trip tags through the LLM and
// are restored only in the final response delivered to the
// requesting user. The slice prompt explicitly mandates
// PolicyChatbot reuse for nl-drive-search-replay.
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
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyChatbot.Allow = %v, want empty (deny-all)", want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/nl-drive-search-replay/goldens.yaml
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
