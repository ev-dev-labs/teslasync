package tools

import (
	"context"
	"encoding/json"
	"sort"
	"testing"
)

// fakeTool is a no-op Tool for registry tests.
type fakeTool struct {
	name    string
	mutates bool
	scope   string
}

func (f *fakeTool) Name() string                 { return f.name }
func (f *fakeTool) Description() string          { return "fake tool: " + f.name }
func (f *fakeTool) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (f *fakeTool) OutputSchema() json.RawMessage {
	return nil
}
func (f *fakeTool) Mutates() bool       { return f.mutates }
func (f *fakeTool) RequiredScope() string { return f.scope }
func (f *fakeTool) Validate(raw json.RawMessage) (any, error) {
	return struct{}{}, nil
}
func (f *fakeTool) Execute(ctx context.Context, in any) (any, error) {
	return map[string]any{"name": f.name}, nil
}

func TestRegistry_RegisterAndGet(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	a := &fakeTool{name: "alpha"}
	b := &fakeTool{name: "beta"}
	r.Register(a)
	r.Register(b)

	got, ok := r.Get("alpha")
	if !ok || got != a {
		t.Errorf("Get(alpha) = %v, %v; want %v, true", got, ok, a)
	}
	if _, ok := r.Get("missing"); ok {
		t.Errorf("Get(missing) should return ok=false")
	}
}

func TestRegistry_NamesSorted(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	r.Register(&fakeTool{name: "charlie"})
	r.Register(&fakeTool{name: "alpha"})
	r.Register(&fakeTool{name: "bravo"})
	names := r.Names()
	want := []string{"alpha", "bravo", "charlie"}
	if !sort.StringsAreSorted(names) {
		t.Errorf("Names() not sorted: %v", names)
	}
	if len(names) != 3 || names[0] != want[0] {
		t.Errorf("Names() = %v, want %v", names, want)
	}
}

func TestRegistry_RegisterDuplicatePanics(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	r.Register(&fakeTool{name: "x"})
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic on duplicate register")
		}
	}()
	r.Register(&fakeTool{name: "x"})
}

func TestRegistry_RegisterEmptyNamePanics(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic on empty name")
		}
	}()
	r.Register(&fakeTool{name: ""})
}

func TestRegistry_RegisterNilPanics(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic on nil tool")
		}
	}()
	r.Register(nil)
}

func TestRegistry_Specs(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	r.Register(&fakeTool{name: "alpha"})
	r.Register(&fakeTool{name: "beta"})
	specs := r.Specs()
	if len(specs) != 2 {
		t.Fatalf("Specs() len = %d, want 2", len(specs))
	}
	if specs[0].Name != "alpha" || specs[1].Name != "beta" {
		t.Errorf("Specs() order = %v / %v", specs[0].Name, specs[1].Name)
	}
}

func TestRegistry_FilterByScope(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	r.Register(&fakeTool{name: "free"})                  // no scope
	r.Register(&fakeTool{name: "admin", scope: "admin"}) // requires admin
	r.Register(&fakeTool{name: "fleet", scope: "fleet"}) // requires fleet

	// Caller has neither scope: only "free" is visible.
	got := r.Filter(nil)
	if names := got.Names(); len(names) != 1 || names[0] != "free" {
		t.Errorf("Filter(nil) = %v, want [free]", names)
	}

	// Caller has fleet scope: free + fleet are visible.
	got = r.Filter([]string{"fleet"})
	names := got.Names()
	if len(names) != 2 || names[0] != "fleet" || names[1] != "free" {
		t.Errorf("Filter(fleet) = %v, want [fleet free]", names)
	}

	// Caller has both scopes: everything visible.
	got = r.Filter([]string{"admin", "fleet"})
	if len(got.Names()) != 3 {
		t.Errorf("Filter(admin,fleet) len = %d, want 3", len(got.Names()))
	}
}

func TestRegistry_DefinitionsCarriesMutates(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	r.Register(&fakeTool{name: "ro"})
	r.Register(&fakeTool{name: "rw", mutates: true})
	defs := r.Definitions()
	by := map[string]Definition{}
	for _, d := range defs {
		by[d.Name] = d
	}
	if by["ro"].Mutates {
		t.Errorf("ro should not be mutating")
	}
	if !by["rw"].Mutates {
		t.Errorf("rw should be mutating")
	}
}

func TestRegistry_MustValidateUnknownToolErrors(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	if _, err := r.MustValidate("nope", json.RawMessage(`{}`)); err == nil {
		t.Errorf("expected error for unknown tool")
	}
}
