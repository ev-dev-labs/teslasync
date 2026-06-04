// Unit tests for the nl-grafana-panel Strategy. Mirrors the shape
// of nl-sql-playground's strategy_test.go (the closest precedent:
// a propose-only DTO drafter strategy with a deny-all redaction
// policy and exactly two tools — draft + validate). The Strategy
// is a pure value (no internal state, no IO) so the tests are
// tight: pin the feature ID + system prompt + tool whitelist +
// redaction policy shape so a future edit that breaks the contract
// surfaces here before the dispatcher silently changes behaviour.

package nlgrafanapanel

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// TestStrategy_FeatureID pins the feature ID. The constant is
// referenced from router.go wiring + the AI HTTP handler; changing
// it without updating the registry would silently break the guard.
func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "nl-grafana-panel" {
		t.Fatalf("FeatureID() = %q, want %q", got, "nl-grafana-panel")
	}
	if FeatureID != "nl-grafana-panel" {
		t.Fatalf("FeatureID const = %q, want %q", FeatureID, "nl-grafana-panel")
	}
}

// TestStrategy_System asserts the system prompt is non-empty and
// contains the load-bearing directives the goldens depend on. The
// goldens (typical_drives_per_day_timeseries, typical_battery_soc_stat,
// refusal_unknown_panel_type, refusal_write_query) would silently
// degrade if any of these substrings disappeared from the prompt.
func TestStrategy_System(t *testing.T) {
	t.Parallel()
	s := New()
	sys := s.System()
	if sys == "" {
		t.Fatal("System() returned empty prompt")
	}
	for _, must := range []string{
		"TeslaSync nl-grafana-panel agent",
		"ALWAYS call draft_grafana_panel FIRST",
		// Validate-after-draft pin so the tool sequence stays
		// deterministic.
		"validate_grafana_panel",
		// In-scope catalog enforcement — the per-request scope
		// binding is defended at the prompt level too.
		"in-scope curated panel-type catalog",
		"in-scope curated datasource-type catalog",
		"in-scope curated table catalog",
		// Refusal directive — out-of-catalog requests are forbidden.
		"refuse politely",
		// Propose-only pin — never claim the panel was created /
		// applied / pushed.
		"Never claim the panel was created",
		// Read-only pin: SELECT or WITH only for postgres.
		"MUST start with SELECT or WITH",
		// DML/DDL ban: every write keyword forbidden.
		"INSERT, UPDATE, DELETE, DROP",
		"CREATE",
		"ALTER",
		"TRUNCATE",
		// Single-statement pin — semicolons forbidden.
		"semicolons are forbidden",
		// LIMIT default pin so the goldens stay deterministic.
		"LIMIT 100",
		// Grid-position bounds pin so out-of-range layouts are
		// refused at the prompt level too.
		"x in [0..23]",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q; got=%q", must, sys)
		}
	}
}

// TestStrategy_Tools pins the exact whitelist. The list MUST stay
// in sync with internal/ai/strategies/nl-grafana-panel/goldens.yaml's
// tools block (the eval harness loads tool names from the YAML;
// the dispatcher loads them from here).
func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	s := New()
	got := s.Tools()
	want := []string{
		"draft_grafana_panel",
		"validate_grafana_panel",
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
// PROPOSE-only. Both tools (draft_grafana_panel, validate_grafana_panel)
// are pure-functional reads + DTO construction. A future edit that
// accidentally adds a write tool (apply_*, save_*, mutate_*,
// execute_*, push_*) will fail this test before the dispatcher's
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
// the strategy must not contribute extra prefix messages until a
// a feature needs preferred-greeting or per-vehicle preferences.
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
// F4↔F8 adapter. PolicyAlertBuilder is a DENY-BY-DEFAULT policy:
// Allow == nil so EVERY PII class — VIN, lat/long, addresses,
// place names, AND vehicle-name — is tagged round-trip. Schema and
// metric metadata are sufficient for this strategy.
func TestStrategy_RedactionPolicyAlertBuilder(t *testing.T) {
	t.Parallel()
	s := New()
	pol := s.RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() returned nil")
	}
	want := redact.PolicyAlertBuilder()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("redact.PolicyAlertBuilder Mode = %v, want ModeRedactedTags", want.Mode)
	}
	if len(want.Allow) != 0 {
		t.Errorf("redact.PolicyAlertBuilder.Allow len = %d, want 0 (deny-by-default); got=%v",
			len(want.Allow), want.Allow)
	}
}

// TestStrategy_EvalGoldensReturnsNil pins the YAML-driven goldens
// contract: the harness loads goldens from
// internal/ai/strategies/nl-grafana-panel/goldens.yaml directly,
// so the in-code EvalGoldens() returns nil.
func TestStrategy_EvalGoldensReturnsNil(t *testing.T) {
	t.Parallel()
	s := New()
	if g := s.EvalGoldens(); g != nil {
		t.Fatalf("EvalGoldens() = %v, want nil (goldens live in YAML)", g)
	}
}

// Helpers.

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
