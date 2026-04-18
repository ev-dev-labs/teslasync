package condition

import (
	"encoding/json"
	"strings"
	"testing"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestParseVariableCheckConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "variable_check",
		"key": "last_charge_level",
		"operator": "lt",
		"value": "50"
	}`)

	cfg, err := ParseVariableCheckConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Key != "last_charge_level" {
		t.Fatalf("expected key 'last_charge_level', got %q", cfg.Key)
	}
	if cfg.Operator != "lt" {
		t.Fatalf("expected operator 'lt', got %q", cfg.Operator)
	}
	if cfg.Value != "50" {
		t.Fatalf("expected value '50', got %q", cfg.Value)
	}
}

func TestParseVariableCheckConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"key": "flag", "operator": "eq", "value": "true"}`)
	cfg, err := ParseVariableCheckConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "" {
		t.Fatalf("expected empty type, got %q", cfg.Type)
	}
}

func TestParseVariableCheckConfig_EmptyValueAllowed(t *testing.T) {
	raw := json.RawMessage(`{"key": "flag", "operator": "eq", "value": ""}`)
	cfg, err := ParseVariableCheckConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Value != "" {
		t.Fatalf("expected empty value, got %q", cfg.Value)
	}
}

func TestParseVariableCheckConfig_Errors(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr string
	}{
		{"empty", "", "condition config is empty"},
		{"invalid json", "{bad", "unmarshal condition config"},
		{"wrong type", `{"type":"other","key":"k","operator":"eq","value":"v"}`, `expected type "variable_check"`},
		{"missing key", `{"operator":"eq","value":"v"}`, "key is required"},
		{"missing operator", `{"key":"k","value":"v"}`, "operator is required"},
		{"unsupported operator", `{"key":"k","operator":"like","value":"v"}`, "unsupported operator"},
		{"non-numeric for gt", `{"key":"k","operator":"gt","value":"abc"}`, "must be numeric"},
		{"non-numeric for lt", `{"key":"k","operator":"lt","value":"xyz"}`, "must be numeric"},
		{"non-numeric for gte", `{"key":"k","operator":"gte","value":""}`, "must be numeric"},
		{"non-numeric for lte", `{"key":"k","operator":"lte","value":"nope"}`, "must be numeric"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseVariableCheckConfig(json.RawMessage(tt.json))
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %q", tt.wantErr, err.Error())
			}
		})
	}
}

// ─── Evaluate Tests ────────────────────────────────────

func TestEvaluateVariableCheck_NotSet(t *testing.T) {
	cfg := &VariableCheckConfig{Key: "missing", Operator: "eq", Value: "x"}

	result, snapshot, err := EvaluateVariableCheck(cfg, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Fatal("expected Met=false for unset variable")
	}
	if !strings.Contains(result.Reason, "not set") {
		t.Fatalf("expected 'not set' in reason, got %q", result.Reason)
	}
	if snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
}

func TestEvaluateVariableCheck_StringEquality(t *testing.T) {
	tests := []struct {
		name     string
		actual   string
		operator string
		expected string
		wantMet  bool
	}{
		{"eq match", "hello", "eq", "hello", true},
		{"eq mismatch", "hello", "eq", "world", false},
		{"neq match", "hello", "neq", "world", true},
		{"neq mismatch", "hello", "neq", "hello", false},
		{"eq empty string", "", "eq", "", true},
		{"neq empty vs non-empty", "", "neq", "x", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &VariableCheckConfig{Key: "test", Operator: tt.operator, Value: tt.expected}

			result, _, err := EvaluateVariableCheck(cfg, &tt.actual)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Fatalf("expected Met=%v, got %v (reason: %s)", tt.wantMet, result.Met, result.Reason)
			}
		})
	}
}

func TestEvaluateVariableCheck_NumericComparison(t *testing.T) {
	tests := []struct {
		name     string
		actual   string
		operator string
		expected string
		wantMet  bool
	}{
		{"gt true", "85", "gt", "50", true},
		{"gt false", "30", "gt", "50", false},
		{"gt equal", "50", "gt", "50", false},
		{"lt true", "30", "lt", "50", true},
		{"lt false", "85", "lt", "50", false},
		{"gte true equal", "50", "gte", "50", true},
		{"gte true greater", "51", "gte", "50", true},
		{"gte false", "49", "gte", "50", false},
		{"lte true equal", "50", "lte", "50", true},
		{"lte true less", "49", "lte", "50", true},
		{"lte false", "51", "lte", "50", false},
		{"float comparison", "3.14", "gt", "3.0", true},
		{"negative numbers", "-5", "lt", "0", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &VariableCheckConfig{Key: "test", Operator: tt.operator, Value: tt.expected}

			result, _, err := EvaluateVariableCheck(cfg, &tt.actual)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Fatalf("expected Met=%v, got %v (reason: %s)", tt.wantMet, result.Met, result.Reason)
			}
		})
	}
}

func TestEvaluateVariableCheck_NonNumericActual(t *testing.T) {
	cfg := &VariableCheckConfig{Key: "test", Operator: "gt", Value: "50"}
	actual := "not-a-number"

	result, _, err := EvaluateVariableCheck(cfg, &actual)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Fatal("expected Met=false for non-numeric actual")
	}
	if !strings.Contains(result.Reason, "not numeric") {
		t.Fatalf("expected 'not numeric' in reason, got %q", result.Reason)
	}
}

func TestEvaluateVariableCheck_SnapshotShape(t *testing.T) {
	cfg := &VariableCheckConfig{Key: "level", Operator: "eq", Value: "high"}
	actual := "high"

	_, snapshot, err := EvaluateVariableCheck(cfg, &actual)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap variableCheckSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}

	if snap.Key != "level" {
		t.Fatalf("expected key 'level', got %q", snap.Key)
	}
	if snap.Operator != "eq" {
		t.Fatalf("expected operator 'eq', got %q", snap.Operator)
	}
	if snap.Expected != "high" {
		t.Fatalf("expected 'high', got %q", snap.Expected)
	}
	if snap.Actual == nil || *snap.Actual != "high" {
		t.Fatalf("expected actual 'high', got %v", snap.Actual)
	}
	if !snap.Met {
		t.Fatal("expected Met=true")
	}
}
