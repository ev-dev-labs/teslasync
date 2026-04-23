package telemetry

import "testing"

func TestLookupHotNil(t *testing.T) {
	if got := LookupHot("does-not-exist"); got != nil {
		t.Fatalf("expected nil for unknown signal, got %+v", got)
	}
}
