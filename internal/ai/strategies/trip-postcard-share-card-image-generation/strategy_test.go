// Phase-50 / 0060 — GEN1 Trip postcard and share-card image generation.
package trippostcardsharecardimagegeneration

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

func TestStrategy_FeatureID(t *testing.T) {
	t.Parallel()
	s := New()
	if got := s.FeatureID(); got != "trip-postcard-share-card-image-generation" {
		t.Fatalf("FeatureID() = %q, want trip-postcard-share-card-image-generation", got)
	}
	if FeatureID != "trip-postcard-share-card-image-generation" {
		t.Fatalf("FeatureID const = %q", FeatureID)
	}
}

func TestStrategy_System(t *testing.T) {
	t.Parallel()
	sys := New().System()
	if sys == "" {
		t.Fatal("System() empty")
	}
	for _, must := range []string{
		"TeslaSync trip postcard / share-card image-prompt assistant",
		"NEVER save anything",
		"NEVER fetch external image services",
		"ALWAYS call draft_image_prompt FIRST",
		"render_share_card_preview",
		"Do NOT invent facts",
		"Refuse politely",
		"Never quote precise street addresses",
	} {
		if !contains(sys, must) {
			t.Errorf("System() missing %q", must)
		}
	}
}

func TestStrategy_Tools(t *testing.T) {
	t.Parallel()
	got := New().Tools()
	want := []string{"draft_image_prompt", "render_share_card_preview"}
	if len(got) != len(want) {
		t.Fatalf("Tools() = %v, want %v", got, want)
	}
	for i, name := range want {
		if got[i] != name {
			t.Errorf("Tools()[%d] = %q, want %q", i, got[i], name)
		}
	}
}

func TestStrategy_ToolsIsDefensiveCopy(t *testing.T) {
	t.Parallel()
	s := New()
	first := s.Tools()
	first[0] = "MUTATED"
	if s.Tools()[0] == "MUTATED" {
		t.Fatal("Tools() leaked mutation")
	}
}

func TestStrategy_ToolsIncludesNoMutators(t *testing.T) {
	t.Parallel()
	for _, name := range New().Tools() {
		switch {
		case startsWith(name, "draft_"),
			startsWith(name, "render_"),
			startsWith(name, "validate_"),
			startsWith(name, "query_"),
			startsWith(name, "retrieve_"):
		default:
			t.Errorf("non-propose-only tool %q", name)
		}
	}
}

func TestStrategy_ContextReturnsNil(t *testing.T) {
	t.Parallel()
	msgs, err := New().Context(context.Background(), strategy.StrategyInput{})
	if err != nil {
		t.Fatalf("Context() err = %v", err)
	}
	if msgs != nil {
		t.Fatalf("Context() = %v, want nil", msgs)
	}
}

func TestStrategy_RedactionPolicyDigest(t *testing.T) {
	t.Parallel()
	pol := New().RedactionPolicy()
	if pol == nil {
		t.Fatal("RedactionPolicy() nil")
	}
	want := redact.PolicyDigest()
	if want.Mode != redact.ModeRedactedTags {
		t.Errorf("PolicyDigest.Mode = %v, want ModeRedactedTags", want.Mode)
	}
	allowsVehicleName := false
	for _, c := range want.Allow {
		if c == redact.ClassVehicleName {
			allowsVehicleName = true
		}
	}
	if !allowsVehicleName {
		t.Errorf("PolicyDigest.Allow missing ClassVehicleName; got=%v", want.Allow)
	}
	for _, c := range want.Allow {
		switch c {
		case redact.ClassLatLong, redact.ClassStreetAddr:
			t.Errorf("PolicyDigest.Allow leaks location class %q", c)
		}
	}
}

func TestStrategy_EvalGoldensReturnsNil(t *testing.T) {
	t.Parallel()
	if g := New().EvalGoldens(); g != nil {
		t.Fatalf("EvalGoldens() = %v, want nil", g)
	}
}

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
