package features

import "testing"

// TestCoverageOK is the canonical CI gate that asserts every entry in
// Registry has populated surface metadata, the map-key invariant
// holds, and DefaultOn is false everywhere (ADR-015 §I7).
//
// A new feature slice that adds an entry without populating Routes,
// Name, Tier, or that flips DefaultOn=true, fails this test.
func TestCoverageOK(t *testing.T) {
	if err := CoverageOK(); err != nil {
		t.Fatalf("registry CoverageOK: %v", err)
	}
}

// TestRegistry_KnownAndUnknown documents the IsKnown contract used by
// guard.Wrap to fail fast on a typo at boot.
func TestRegistry_KnownAndUnknown(t *testing.T) {
	if !IsKnown("chatbot-llm") {
		t.Fatal("chatbot-llm should be a known feature ID (slice F0 seed)")
	}
	if IsKnown("not-a-feature") {
		t.Fatal("not-a-feature must not be known")
	}
	if IsKnown("") {
		t.Fatal("empty string must not be a known feature ID")
	}
}

// TestIDs_DeterministicOrder asserts the TS generator can rely on
// IDs() returning lexicographically-sorted output.
func TestIDs_DeterministicOrder(t *testing.T) {
	got := IDs()
	for i := 1; i < len(got); i++ {
		if got[i-1] >= got[i] {
			t.Fatalf("IDs() not strictly ascending at index %d: %q vs %q", i, got[i-1], got[i])
		}
	}
}
