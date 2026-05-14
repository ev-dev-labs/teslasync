package eval

import (
	"context"
	"encoding/json"
	"testing"
)

func TestStubTool_Defaults(t *testing.T) {
	t.Parallel()
	tool := newStubTool("query_battery_status", false)
	if tool.Name() != "query_battery_status" {
		t.Errorf("Name = %q", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates true, want false")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope = %q", tool.RequiredScope())
	}
	if string(tool.OutputSchema()) != "" {
		t.Errorf("OutputSchema not empty: %s", tool.OutputSchema())
	}
	v, err := tool.Validate(json.RawMessage(`{"vehicle_id":1}`))
	if err != nil {
		t.Errorf("Validate: %v", err)
	}
	if m, ok := v.(map[string]any); !ok {
		t.Errorf("Validate type = %T", v)
	} else if m["vehicle_id"].(float64) != 1 {
		t.Errorf("Validate args lost: %v", m)
	}

	out, err := tool.Execute(context.Background(), nil)
	if err != nil {
		t.Errorf("Execute: %v", err)
	}
	if m, ok := out.(map[string]any); !ok || m["ok"] != true {
		t.Errorf("Execute = %v", out)
	}
}

func TestStubTool_ValidateAcceptsEmpty(t *testing.T) {
	t.Parallel()
	tool := newStubTool("noop", false)
	v, err := tool.Validate(nil)
	if err != nil {
		t.Errorf("Validate(nil): %v", err)
	}
	if _, ok := v.(map[string]any); !ok {
		t.Errorf("type = %T", v)
	}
}

func TestStubTool_ValidateRejectsBadJSON(t *testing.T) {
	t.Parallel()
	tool := newStubTool("noop", false)
	_, err := tool.Validate(json.RawMessage("{not json"))
	if err == nil {
		t.Error("expected error")
	}
}

func TestBuildStubRegistry_RegistersAllNames(t *testing.T) {
	t.Parallel()
	reg := buildStubRegistry(FeatureSpec{
		ID:            "x",
		Tools:         []string{"a", "b", "c"},
		MutatingTools: []string{"b"},
	})
	names := reg.Names()
	if len(names) != 3 {
		t.Fatalf("names = %v", names)
	}
	a, _ := reg.Get("a")
	b, _ := reg.Get("b")
	if a.Mutates() {
		t.Error("a should be non-mutating")
	}
	if !b.Mutates() {
		t.Error("b should be mutating")
	}
}
