package condition

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestDecodeStateCheckSpec_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "state_check",
		"field": "battery_level",
		"operator": "gt",
		"value": 20
	}`)

	cfg, err := DecodeStateCheckSpec(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "state_check" {
		t.Fatalf("expected type 'state_check', got %q", cfg.Type)
	}
	if cfg.Field != "battery_level" {
		t.Fatalf("expected field 'battery_level', got %q", cfg.Field)
	}
	if cfg.Operator != "gt" {
		t.Fatalf("expected operator 'gt', got %q", cfg.Operator)
	}
	if cfg.NumberValue == nil || *cfg.NumberValue != 20 {
		t.Fatalf("expected NumberValue=20, got %v", cfg.NumberValue)
	}
}

func TestDecodeStateCheckSpec_BoolField(t *testing.T) {
	raw := json.RawMessage(`{"field": "is_locked", "operator": "eq", "value": true}`)
	cfg, err := DecodeStateCheckSpec(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.BoolValue == nil || *cfg.BoolValue != true {
		t.Fatalf("expected BoolValue=true, got %v", cfg.BoolValue)
	}
}

func TestDecodeStateCheckSpec_StringField(t *testing.T) {
	raw := json.RawMessage(`{"field": "state", "operator": "eq", "value": "online"}`)
	cfg, err := DecodeStateCheckSpec(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.StringValue == nil || *cfg.StringValue != "online" {
		t.Fatalf("expected StringValue='online', got %v", cfg.StringValue)
	}
}

func TestDecodeStateCheckSpec_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"field": "speed", "operator": "lte", "value": 100}`)
	cfg, err := DecodeStateCheckSpec(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "" {
		t.Fatalf("expected empty type, got %q", cfg.Type)
	}
	if cfg.NumberValue == nil || *cfg.NumberValue != 100 {
		t.Fatalf("expected NumberValue=100, got %v", cfg.NumberValue)
	}
}

func TestDecodeStateCheckSpec_Errors(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"empty", ""},
		{"invalid json", "{bad"},
		{"wrong type", `{"type": "other", "field": "speed", "operator": "gt", "value": 10}`},
		{"missing field", `{"operator": "eq", "value": true}`},
		{"unsupported field", `{"field": "unknown_field", "operator": "eq", "value": 1}`},
		{"missing operator", `{"field": "speed", "value": 10}`},
		{"unsupported operator", `{"field": "speed", "operator": "like", "value": 10}`},
		{"missing value", `{"field": "speed", "operator": "gt"}`},
		{"null value", `{"field": "speed", "operator": "gt", "value": null}`},
		{"gt on bool field", `{"field": "is_locked", "operator": "gt", "value": true}`},
		{"lt on bool field", `{"field": "sentry_mode", "operator": "lt", "value": false}`},
		{"gte on bool field", `{"field": "is_charging", "operator": "gte", "value": true}`},
		{"lte on string field", `{"field": "state", "operator": "lte", "value": "online"}`},
		{"gt on string field", `{"field": "state", "operator": "gt", "value": "asleep"}`},
		{"string value for bool field", `{"field": "is_locked", "operator": "eq", "value": "yes"}`},
		{"bool value for numeric field", `{"field": "speed", "operator": "gt", "value": true}`},
		{"number value for string field", `{"field": "state", "operator": "eq", "value": 42}`},
		{"string value for numeric field", `{"field": "battery_level", "operator": "gt", "value": "high"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DecodeStateCheckSpec(json.RawMessage(tt.json))
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.name)
			}
		})
	}
}

func TestDecodeStateCheckSpec_AllFields(t *testing.T) {
	fields := []struct {
		name     string
		value    string
		wantBool bool
		wantNum  bool
		wantStr  bool
	}{
		{"is_locked", "true", true, false, false},
		{"is_charging", "false", true, false, false},
		{"is_climate_on", "true", true, false, false},
		{"sentry_mode", "false", true, false, false},
		{"battery_level", "50", false, true, false},
		{"inside_temp", "22.5", false, true, false},
		{"outside_temp", "15.0", false, true, false},
		{"speed", "65.3", false, true, false},
		{"state", `"online"`, false, false, true},
	}

	for _, tt := range fields {
		t.Run(tt.name, func(t *testing.T) {
			raw := json.RawMessage(`{"field": "` + tt.name + `", "operator": "eq", "value": ` + tt.value + `}`)
			cfg, err := DecodeStateCheckSpec(raw)
			if err != nil {
				t.Fatalf("unexpected error for field %q: %v", tt.name, err)
			}
			if (cfg.BoolValue != nil) != tt.wantBool {
				t.Errorf("BoolValue set=%v, want=%v", cfg.BoolValue != nil, tt.wantBool)
			}
			if (cfg.NumberValue != nil) != tt.wantNum {
				t.Errorf("NumberValue set=%v, want=%v", cfg.NumberValue != nil, tt.wantNum)
			}
			if (cfg.StringValue != nil) != tt.wantStr {
				t.Errorf("StringValue set=%v, want=%v", cfg.StringValue != nil, tt.wantStr)
			}
		})
	}
}

// ─── Evaluation Tests — Boolean Fields ──────────────────

func TestEvaluateStateCheck_BoolEq(t *testing.T) {
	trueVal := true
	falseVal := false

	tests := []struct {
		name     string
		field    string
		expected *bool
		state    *models.VehicleState
		wantMet  bool
	}{
		{
			"is_locked eq true, locked",
			"is_locked", &trueVal,
			&models.VehicleState{IsLocked: true},
			true,
		},
		{
			"is_locked eq true, unlocked",
			"is_locked", &trueVal,
			&models.VehicleState{IsLocked: false},
			false,
		},
		{
			"is_charging eq false, not charging",
			"is_charging", &falseVal,
			&models.VehicleState{IsCharging: false},
			true,
		},
		{
			"is_climate_on eq true, climate on",
			"is_climate_on", &trueVal,
			&models.VehicleState{IsClimateOn: true},
			true,
		},
		{
			"sentry_mode eq false, sentry on",
			"sentry_mode", &falseVal,
			&models.VehicleState{SentryMode: true},
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &StateCheckConfig{
				Field:     tt.field,
				Operator:  "eq",
				BoolValue: tt.expected,
			}
			result, snapshot, err := EvaluateStateCheck(cfg, tt.state)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("got met=%v, want %v (reason: %s)", result.Met, tt.wantMet, result.Reason)
			}
			if snapshot == nil {
				t.Fatal("expected non-nil snapshot")
			}
		})
	}
}

func TestEvaluateStateCheck_BoolNeq(t *testing.T) {
	trueVal := true

	cfg := &StateCheckConfig{
		Field:     "is_locked",
		Operator:  "neq",
		BoolValue: &trueVal,
	}

	// is_locked=false, expected=true → neq → met
	result, _, err := EvaluateStateCheck(cfg, &models.VehicleState{IsLocked: false})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true, got false: %s", result.Reason)
	}

	// is_locked=true, expected=true → neq → not met
	result, _, err = EvaluateStateCheck(cfg, &models.VehicleState{IsLocked: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected met=false, got true: %s", result.Reason)
	}
}

// ─── Evaluation Tests — Numeric Fields ──────────────────

func TestEvaluateStateCheck_NumericOperators(t *testing.T) {
	val20 := float64(20)

	tests := []struct {
		name    string
		op      string
		actual  int // battery_level
		wantMet bool
	}{
		{"eq match", "eq", 20, true},
		{"eq mismatch", "eq", 21, false},
		{"neq match", "neq", 19, true},
		{"neq mismatch", "neq", 20, false},
		{"gt match", "gt", 45, true},
		{"gt boundary", "gt", 20, false},
		{"gt below", "gt", 10, false},
		{"lt match", "lt", 10, true},
		{"lt boundary", "lt", 20, false},
		{"lt above", "lt", 30, false},
		{"gte match above", "gte", 25, true},
		{"gte match exact", "gte", 20, true},
		{"gte below", "gte", 19, false},
		{"lte match below", "lte", 15, true},
		{"lte match exact", "lte", 20, true},
		{"lte above", "lte", 21, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &StateCheckConfig{
				Field:       "battery_level",
				Operator:    tt.op,
				NumberValue: &val20,
			}
			state := &models.VehicleState{BatteryLevel: tt.actual}
			result, _, err := EvaluateStateCheck(cfg, state)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("battery_level=%d %s 20: got met=%v, want %v (reason: %s)",
					tt.actual, tt.op, result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateStateCheck_NumericDecimal(t *testing.T) {
	val25 := 25.5

	cfg := &StateCheckConfig{
		Field:       "inside_temp",
		Operator:    "gt",
		NumberValue: &val25,
	}

	tests := []struct {
		name    string
		temp    float64
		wantMet bool
	}{
		{"above", 30.0, true},
		{"exact", 25.5, false},
		{"below", 20.0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state := &models.VehicleState{InsideTemp: tt.temp}
			result, _, err := EvaluateStateCheck(cfg, state)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("inside_temp=%.1f gt 25.5: got met=%v, want %v",
					tt.temp, result.Met, tt.wantMet)
			}
		})
	}
}

func TestEvaluateStateCheck_SpeedField(t *testing.T) {
	val100 := float64(100)

	cfg := &StateCheckConfig{
		Field:       "speed",
		Operator:    "lte",
		NumberValue: &val100,
	}

	state := &models.VehicleState{Speed: 88.5}
	result, _, err := EvaluateStateCheck(cfg, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected speed 88.5 <= 100 to be met: %s", result.Reason)
	}
}

func TestEvaluateStateCheck_OutsideTempField(t *testing.T) {
	val0 := float64(0)

	cfg := &StateCheckConfig{
		Field:       "outside_temp",
		Operator:    "lt",
		NumberValue: &val0,
	}

	state := &models.VehicleState{OutsideTemp: -5.2}
	result, _, err := EvaluateStateCheck(cfg, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected outside_temp -5.2 < 0 to be met: %s", result.Reason)
	}
}

// ─── Evaluation Tests — String Fields ───────────────────

func TestEvaluateStateCheck_StringEq(t *testing.T) {
	online := "online"

	cfg := &StateCheckConfig{
		Field:       "state",
		Operator:    "eq",
		StringValue: &online,
	}

	tests := []struct {
		name    string
		state   string
		wantMet bool
	}{
		{"match", "online", true},
		{"mismatch", "asleep", false},
		{"case sensitive", "Online", false},
		{"empty", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vs := &models.VehicleState{State: tt.state}
			result, _, err := EvaluateStateCheck(cfg, vs)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("state=%q eq 'online': got met=%v, want %v",
					tt.state, result.Met, tt.wantMet)
			}
		})
	}
}

func TestEvaluateStateCheck_StringNeq(t *testing.T) {
	asleep := "asleep"

	cfg := &StateCheckConfig{
		Field:       "state",
		Operator:    "neq",
		StringValue: &asleep,
	}

	result, _, err := EvaluateStateCheck(cfg, &models.VehicleState{State: "online"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected state='online' neq 'asleep' to be met: %s", result.Reason)
	}

	result, _, err = EvaluateStateCheck(cfg, &models.VehicleState{State: "asleep"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected state='asleep' neq 'asleep' to be not met: %s", result.Reason)
	}
}

// ─── Error Cases ────────────────────────────────────────

func TestEvaluateStateCheck_NilState(t *testing.T) {
	val := float64(50)
	cfg := &StateCheckConfig{
		Field:       "battery_level",
		Operator:    "gt",
		NumberValue: &val,
	}

	_, _, err := EvaluateStateCheck(cfg, nil)
	if err == nil {
		t.Fatal("expected error for nil state, got nil")
	}
}

// ─── Snapshot Tests ─────────────────────────────────────

func TestEvaluateStateCheck_SnapshotContent(t *testing.T) {
	val20 := float64(20)
	cfg := &StateCheckConfig{
		Type:        "state_check",
		Field:       "battery_level",
		Operator:    "gt",
		NumberValue: &val20,
	}

	state := &models.VehicleState{BatteryLevel: 45}
	_, snapshot, err := EvaluateStateCheck(cfg, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap stateCheckSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.Field != "battery_level" {
		t.Errorf("expected field 'battery_level', got %q", snap.Field)
	}
	if snap.Operator != "gt" {
		t.Errorf("expected operator 'gt', got %q", snap.Operator)
	}
	if snap.Expected != float64(20) {
		t.Errorf("expected expected=20, got %v", snap.Expected)
	}
	if snap.Actual != float64(45) {
		t.Errorf("expected actual=45, got %v", snap.Actual)
	}
	if !snap.Met {
		t.Error("expected met=true in snapshot")
	}
}

func TestEvaluateStateCheck_SnapshotBoolField(t *testing.T) {
	trueVal := true
	cfg := &StateCheckConfig{
		Field:     "is_locked",
		Operator:  "eq",
		BoolValue: &trueVal,
	}

	state := &models.VehicleState{IsLocked: false}
	_, snapshot, err := EvaluateStateCheck(cfg, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap stateCheckSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.Actual != false {
		t.Errorf("expected actual=false, got %v", snap.Actual)
	}
	if snap.Expected != true {
		t.Errorf("expected expected=true, got %v", snap.Expected)
	}
	if snap.Met {
		t.Error("expected met=false in snapshot")
	}
}

// ─── Reason String Tests ────────────────────────────────

func TestEvaluateStateCheck_ReasonStrings(t *testing.T) {
	tests := []struct {
		name       string
		cfg        *StateCheckConfig
		state      *models.VehicleState
		wantReason string
	}{
		{
			"numeric gt met",
			numericCfg("battery_level", "gt", 20),
			&models.VehicleState{BatteryLevel: 45},
			"battery_level 45 > 20",
		},
		{
			"numeric gt not met",
			numericCfg("battery_level", "gt", 20),
			&models.VehicleState{BatteryLevel: 15},
			"battery_level 15 > 20",
		},
		{
			"bool eq met",
			boolCfg("is_locked", "eq", true),
			&models.VehicleState{IsLocked: true},
			"is_locked true == true",
		},
		{
			"string eq met",
			stringCfg("state", "eq", "online"),
			&models.VehicleState{State: "online"},
			"state online == online",
		},
		{
			"numeric decimal",
			numericCfg("inside_temp", "gte", 22.5),
			&models.VehicleState{InsideTemp: 23.7},
			"inside_temp 23.7 >= 22.5",
		},
		{
			"numeric lte zero",
			numericCfg("outside_temp", "lte", 0),
			&models.VehicleState{OutsideTemp: -3},
			"outside_temp -3 <= 0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, _, err := EvaluateStateCheck(tt.cfg, tt.state)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Reason != tt.wantReason {
				t.Errorf("got reason %q, want %q", result.Reason, tt.wantReason)
			}
		})
	}
}

// ─── formatValue Tests ──────────────────────────────────

func TestFormatValue(t *testing.T) {
	tests := []struct {
		name string
		val  any
		want string
	}{
		{"true", true, "true"},
		{"false", false, "false"},
		{"integer float", float64(45), "45"},
		{"decimal float", float64(22.5), "22.5"},
		{"negative integer", float64(-3), "-3"},
		{"negative decimal", float64(-5.2), "-5.2"},
		{"zero", float64(0), "0"},
		{"string", "online", "online"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatValue(tt.val)
			if got != tt.want {
				t.Errorf("formatValue(%v) = %q, want %q", tt.val, got, tt.want)
			}
		})
	}
}

// ─── fieldKindName Tests ────────────────────────────────

func TestFieldKindName(t *testing.T) {
	tests := []struct {
		kind fieldKind
		want string
	}{
		{fieldBool, "boolean"},
		{fieldNumeric, "numeric"},
		{fieldString, "string"},
		{fieldKind(99), "unknown"},
	}

	for _, tt := range tests {
		got := fieldKindName(tt.kind)
		if got != tt.want {
			t.Errorf("fieldKindName(%d) = %q, want %q", tt.kind, got, tt.want)
		}
	}
}

// ─── End-to-End via Parse + Evaluate ────────────────────

func TestStateCheck_EndToEnd(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		state   *models.VehicleState
		wantMet bool
	}{
		{
			"battery gt 20, level is 45",
			`{"type": "state_check", "field": "battery_level", "operator": "gt", "value": 20}`,
			&models.VehicleState{BatteryLevel: 45},
			true,
		},
		{
			"battery gt 20, level is 10",
			`{"type": "state_check", "field": "battery_level", "operator": "gt", "value": 20}`,
			&models.VehicleState{BatteryLevel: 10},
			false,
		},
		{
			"is_locked eq true, locked",
			`{"field": "is_locked", "operator": "eq", "value": true}`,
			&models.VehicleState{IsLocked: true},
			true,
		},
		{
			"is_locked eq true, unlocked",
			`{"field": "is_locked", "operator": "eq", "value": true}`,
			&models.VehicleState{IsLocked: false},
			false,
		},
		{
			"state eq online, is online",
			`{"field": "state", "operator": "eq", "value": "online"}`,
			&models.VehicleState{State: "online"},
			true,
		},
		{
			"state neq asleep, is online",
			`{"field": "state", "operator": "neq", "value": "asleep"}`,
			&models.VehicleState{State: "online"},
			true,
		},
		{
			"sentry_mode neq false, sentry on",
			`{"field": "sentry_mode", "operator": "neq", "value": false}`,
			&models.VehicleState{SentryMode: true},
			true,
		},
		{
			"speed lte 120, speed is 88",
			`{"field": "speed", "operator": "lte", "value": 120}`,
			&models.VehicleState{Speed: 88},
			true,
		},
		{
			"inside_temp gte 22, temp is 22",
			`{"field": "inside_temp", "operator": "gte", "value": 22}`,
			&models.VehicleState{InsideTemp: 22},
			true,
		},
		{
			"outside_temp lt 0, temp is -5",
			`{"field": "outside_temp", "operator": "lt", "value": 0}`,
			&models.VehicleState{OutsideTemp: -5},
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := DecodeStateCheckSpec(json.RawMessage(tt.json))
			if err != nil {
				t.Fatalf("parse error: %v", err)
			}
			result, snapshot, err := EvaluateStateCheck(cfg, tt.state)
			if err != nil {
				t.Fatalf("evaluate error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("got met=%v, want %v (reason: %s)", result.Met, tt.wantMet, result.Reason)
			}
			if snapshot == nil {
				t.Fatal("expected non-nil snapshot")
			}
		})
	}
}

// ─── Helpers ────────────────────────────────────────────

func boolCfg(field, op string, val bool) *StateCheckConfig {
	v := val
	return &StateCheckConfig{Field: field, Operator: op, BoolValue: &v}
}

func numericCfg(field, op string, val float64) *StateCheckConfig {
	v := val
	return &StateCheckConfig{Field: field, Operator: op, NumberValue: &v}
}

func stringCfg(field, op string, val string) *StateCheckConfig {
	v := val
	return &StateCheckConfig{Field: field, Operator: op, StringValue: &v}
}
