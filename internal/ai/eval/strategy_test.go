package eval

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

type fakeStrategy struct{ id string }

func (f fakeStrategy) FeatureID() string                                                          { return f.id }
func (f fakeStrategy) System() string                                                             { return "real" }
func (f fakeStrategy) Tools() []string                                                            { return []string{"t1"} }
func (f fakeStrategy) Context(context.Context, strategy.StrategyInput) ([]provider.Message, error) { return nil, nil }
func (f fakeStrategy) RedactionPolicy() strategy.RedactionPolicy                                  { return strategy.NoRedaction{} }
func (f fakeStrategy) EvalGoldens() []strategy.EvalGolden                                         { return nil }

func TestRegisterStrategy_PrefersOverride(t *testing.T) {
	resetStrategyRegistry()
	defer resetStrategyRegistry()

	RegisterStrategy(fakeStrategy{id: "x"})
	got, ok := LookupStrategy("x")
	if !ok {
		t.Fatal("Lookup not ok")
	}
	if got.System() != "real" {
		t.Errorf("System = %q", got.System())
	}
}

func TestRegisterStrategy_NilPanics(t *testing.T) {
	resetStrategyRegistry()
	defer resetStrategyRegistry()
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic")
		}
	}()
	RegisterStrategy(nil)
}

func TestRegisterStrategy_DuplicatePanics(t *testing.T) {
	resetStrategyRegistry()
	defer resetStrategyRegistry()
	RegisterStrategy(fakeStrategy{id: "dup"})
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic on duplicate")
		}
	}()
	RegisterStrategy(fakeStrategy{id: "dup"})
}

func TestGenericStrategy_FieldPassthrough(t *testing.T) {
	t.Parallel()
	g := NewGenericStrategy(FeatureSpec{
		ID:     "feat",
		System: "be helpful",
		Tools:  []string{"t1", "t2"},
	})
	if g.FeatureID() != "feat" {
		t.Errorf("ID = %q", g.FeatureID())
	}
	if g.System() != "be helpful" {
		t.Errorf("System = %q", g.System())
	}
	tools := g.Tools()
	if len(tools) != 2 {
		t.Errorf("Tools = %v", tools)
	}
	tools[0] = "mutated"
	if g.Spec.Tools[0] == "mutated" {
		t.Error("Tools() returned a slice that aliases the spec — should be a defensive copy")
	}
	msgs, err := g.Context(context.Background(), strategy.StrategyInput{LastMessage: "hi"})
	if err != nil || msgs != nil {
		t.Errorf("Context = %v, %v", msgs, err)
	}
	if _, ok := g.RedactionPolicy().(strategy.NoRedaction); !ok {
		t.Errorf("RedactionPolicy = %T", g.RedactionPolicy())
	}
	if g.EvalGoldens() != nil {
		t.Errorf("EvalGoldens not nil")
	}
}
