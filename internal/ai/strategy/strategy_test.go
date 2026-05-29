package strategy

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// fakeStrategy is a sample implementation used to assert the
// interface remains implementable by ordinary user code without
// surprises (no required generics, no embedded structs, etc.).
type fakeStrategy struct{}

func (fakeStrategy) FeatureID() string { return "test-feature" }
func (fakeStrategy) System() string    { return "be helpful" }
func (fakeStrategy) Tools() []string   { return []string{"query_vehicle_count"} }
func (fakeStrategy) Context(ctx context.Context, in StrategyInput) ([]provider.Message, error) {
	return []provider.Message{{Role: provider.RoleSystem, Content: "ctx"}}, nil
}
func (fakeStrategy) RedactionPolicy() RedactionPolicy { return NoRedaction{} }
func (fakeStrategy) EvalGoldens() []EvalGolden        { return nil }

func TestFakeStrategySatisfiesInterface(t *testing.T) {
	t.Parallel()
	var s Strategy = fakeStrategy{}
	if s.FeatureID() != "test-feature" {
		t.Errorf("FeatureID = %q", s.FeatureID())
	}
	if len(s.Tools()) != 1 {
		t.Errorf("Tools = %v", s.Tools())
	}
	msgs, err := s.Context(context.Background(), StrategyInput{LastMessage: "hi"})
	if err != nil {
		t.Fatalf("Context: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("Context messages = %d", len(msgs))
	}
	if _, ok := s.RedactionPolicy().(NoRedaction); !ok {
		t.Errorf("RedactionPolicy type = %T", s.RedactionPolicy())
	}
}

func TestNoRedactionImplementsPolicy(t *testing.T) {
	t.Parallel()
	var p RedactionPolicy = NoRedaction{}
	_ = p // compile-time check is the assertion
}

// Redaction policies live in the strategy package so the dispatcher
// can pass them around without an import cycle.
type localFakePolicy struct{}

func (localFakePolicy) policyMarker() {}

func TestRedactionPolicyMarkerIsUnexported(t *testing.T) {
	t.Parallel()
	var _ RedactionPolicy = localFakePolicy{}
}
