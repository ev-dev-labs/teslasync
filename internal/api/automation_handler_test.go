package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestEvaluateTestConditions_Empty(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{Conditions: json.RawMessage(`[]`)}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty conditions, got %d", len(results))
	}
}

func TestEvaluateTestConditions_NullConditions(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{Conditions: json.RawMessage(`null`)}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 0 {
		t.Errorf("expected 0 results for null conditions, got %d", len(results))
	}
}

func TestEvaluateTestConditions_InvalidJSON(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{Conditions: json.RawMessage(`{not valid`)}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 || results[0].Result != "unknown" {
		t.Errorf("expected 1 unknown result for invalid JSON, got %v", results)
	}
}

func TestEvaluateTestConditions_TimeWindowMet(t *testing.T) {
	h := &AutomationHandler{}
	// Build a time window that is currently active (00:00 - 23:59).
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"time_window","start_time":"00:00","end_time":"23:59"}]`),
	}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "met" {
		t.Errorf("expected time_window to be met, got %q: %s", results[0].Result, results[0].Reason)
	}
}

func TestEvaluateTestConditions_TimeWindowNotMet(t *testing.T) {
	h := &AutomationHandler{}
	// Use a fixed time of 12:00 and a window of 01:00-02:00.
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"time_window","start_time":"01:00","end_time":"02:00"}]`),
	}
	noon := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	results := h.evaluateTestConditions(a, noon)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "not_met" {
		t.Errorf("expected time_window to be not_met at noon, got %q", results[0].Result)
	}
}

func TestEvaluateTestConditions_DayFilter(t *testing.T) {
	h := &AutomationHandler{}
	// Saturday = 6 in Go's time.Weekday
	sat := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC) // April 18, 2026 is a Saturday
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"day_filter","days":[6]}]`),
	}
	results := h.evaluateTestConditions(a, sat)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "met" {
		t.Errorf("expected day_filter to be met on Saturday, got %q: %s", results[0].Result, results[0].Reason)
	}
}

func TestEvaluateTestConditions_SeasonalMet(t *testing.T) {
	h := &AutomationHandler{}
	april := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"seasonal","start_month":3,"end_month":9}]`),
	}
	results := h.evaluateTestConditions(a, april)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "met" {
		t.Errorf("expected seasonal to be met in April (Mar-Sep), got %q", results[0].Result)
	}
}

func TestEvaluateTestConditions_CooldownMet(t *testing.T) {
	h := &AutomationHandler{}
	now := time.Now().UTC()
	lastTriggered := now.Add(-2 * time.Hour)
	a := &models.Automation{
		Conditions:      json.RawMessage(`[{"type":"cooldown","minutes":30}]`),
		LastTriggeredAt: &lastTriggered,
	}
	results := h.evaluateTestConditions(a, now)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "met" {
		t.Errorf("expected cooldown to be met (triggered 2h ago, cooldown 30min), got %q: %s", results[0].Result, results[0].Reason)
	}
}

func TestEvaluateTestConditions_CooldownNotMet(t *testing.T) {
	h := &AutomationHandler{}
	now := time.Now().UTC()
	lastTriggered := now.Add(-5 * time.Minute)
	a := &models.Automation{
		Conditions:      json.RawMessage(`[{"type":"cooldown","minutes":30}]`),
		LastTriggeredAt: &lastTriggered,
	}
	results := h.evaluateTestConditions(a, now)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "not_met" {
		t.Errorf("expected cooldown to be not_met (triggered 5min ago, cooldown 30min), got %q: %s", results[0].Result, results[0].Reason)
	}
}

func TestEvaluateTestConditions_StateCheckUnknown(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"state_check","field":"battery_level","operator":"gte","value":20}]`),
	}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "unknown" {
		t.Errorf("expected state_check to be unknown, got %q", results[0].Result)
	}
}

func TestEvaluateTestConditions_LocationUnknown(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"location","geofence_id":1,"operator":"inside"}]`),
	}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "unknown" {
		t.Errorf("expected location to be unknown, got %q", results[0].Result)
	}
}

func TestEvaluateTestConditions_VariableCheckUnknown(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Conditions: json.RawMessage(`[{"type":"variable_check","key":"my_var","operator":"eq","value":"on"}]`),
	}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Result != "unknown" {
		t.Errorf("expected variable_check to be unknown, got %q", results[0].Result)
	}
}

func TestEvaluateTestConditions_MultipleConditions(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Conditions: json.RawMessage(`[
			{"type":"time_window","start_time":"00:00","end_time":"23:59"},
			{"type":"state_check","field":"is_locked","operator":"eq","value":true},
			{"type":"seasonal","start_month":1,"end_month":12}
		]`),
	}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	if results[0].Result != "met" {
		t.Errorf("time_window should be met, got %q", results[0].Result)
	}
	if results[1].Result != "unknown" {
		t.Errorf("state_check should be unknown, got %q", results[1].Result)
	}
	if results[2].Result != "met" {
		t.Errorf("seasonal should be met, got %q", results[2].Result)
	}
}

// ── simulateActions Tests ───────────────────────────────────────────────

func TestSimulateActions_Empty(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{Actions: json.RawMessage(`[]`)}
	results, valid := h.simulateActions(a, true)
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty actions, got %d", len(results))
	}
	if valid != 0 {
		t.Errorf("expected 0 valid actions, got %d", valid)
	}
}

func TestSimulateActions_ValidCommand(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Actions: json.RawMessage(`[{"type":"command","command":"climate_on"}]`),
	}
	results, valid := h.simulateActions(a, true)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if !results[0].Valid {
		t.Errorf("expected valid action, got error: %s", results[0].Error)
	}
	if !results[0].Simulated {
		t.Error("expected simulated=true")
	}
	if valid != 1 {
		t.Errorf("expected 1 valid action, got %d", valid)
	}

	// Check output contains {success: true, simulated: true}
	var output map[string]interface{}
	if err := json.Unmarshal(results[0].Output, &output); err != nil {
		t.Fatalf("failed to unmarshal output: %v", err)
	}
	if output["success"] != true || output["simulated"] != true {
		t.Errorf("expected {success:true, simulated:true}, got %v", output)
	}
}

func TestSimulateActions_InvalidCommand(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Actions: json.RawMessage(`[{"type":"command","command":"nonexistent_cmd"}]`),
	}
	results, valid := h.simulateActions(a, true)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Valid {
		t.Error("expected invalid action for unknown command")
	}
	if results[0].Error == "" {
		t.Error("expected error message for invalid command")
	}
	if valid != 0 {
		t.Errorf("expected 0 valid actions, got %d", valid)
	}
}

func TestSimulateActions_ConditionsNotMet(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Actions: json.RawMessage(`[{"type":"command","command":"lock"},{"type":"notify","channel":"all","message":"done"}]`),
	}
	results, _ := h.simulateActions(a, false)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	for i, r := range results {
		if !r.WouldSkip {
			t.Errorf("action %d should be would_skip when conditions not met", i)
		}
		if r.SkipReason != "conditions not met" {
			t.Errorf("action %d skip_reason = %q, want %q", i, r.SkipReason, "conditions not met")
		}
	}
}

func TestSimulateActions_StopOnFailure(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		StopOnFailure: true,
		Actions: json.RawMessage(`[
			{"type":"command","command":"nonexistent_cmd"},
			{"type":"command","command":"lock"}
		]`),
	}
	results, valid := h.simulateActions(a, true)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Valid {
		t.Error("first action should be invalid")
	}
	if !results[1].WouldSkip {
		t.Error("second action should be skipped due to stop_on_failure")
	}
	if valid != 0 {
		t.Errorf("expected 0 valid actions, got %d", valid)
	}
}

func TestSimulateActions_MixedTypes(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_on"},
			{"type":"wait","duration_seconds":10},
			{"type":"notify","channel":"all","message":"Climate started for {{vehicle}}"},
			{"type":"set_variable","key":"last_action","value":"climate_on"}
		]`),
	}
	results, valid := h.simulateActions(a, true)
	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}
	for i, r := range results {
		if !r.Valid {
			t.Errorf("action %d should be valid, got error: %s", i, r.Error)
		}
		if !r.Simulated {
			t.Errorf("action %d should be simulated", i)
		}
	}
	if valid != 4 {
		t.Errorf("expected 4 valid actions, got %d", valid)
	}
}

// ── validateActionConfig Tests ──────────────────────────────────────────

func TestValidateActionConfig_Command(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"valid lock", `{"type":"command","command":"lock"}`, false},
		{"valid climate_on", `{"type":"command","command":"climate_on"}`, false},
		{"missing command", `{"type":"command"}`, true},
		{"unknown command", `{"type":"command","command":"fly_to_mars"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := action.ActionConfig{Type: "command", Raw: json.RawMessage(tt.raw)}
			err := validateActionConfig(cfg)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateActionConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateActionConfig_Wait(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"valid 10s", `{"type":"wait","duration_seconds":10}`, false},
		{"zero duration", `{"type":"wait","duration_seconds":0}`, true},
		{"negative", `{"type":"wait","duration_seconds":-1}`, true},
		{"over max", `{"type":"wait","duration_seconds":99999}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := action.ActionConfig{Type: "wait", Raw: json.RawMessage(tt.raw)}
			err := validateActionConfig(cfg)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateActionConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateActionConfig_Notify(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"valid all", `{"type":"notify","channel":"all","message":"hello"}`, false},
		{"valid discord", `{"type":"notify","channel":"discord","message":"test"}`, false},
		{"missing channel", `{"type":"notify","message":"hello"}`, true},
		{"missing message", `{"type":"notify","channel":"all"}`, true},
		{"invalid channel", `{"type":"notify","channel":"carrier_pigeon","message":"x"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := action.ActionConfig{Type: "notify", Raw: json.RawMessage(tt.raw)}
			err := validateActionConfig(cfg)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateActionConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateActionConfig_SetVariable(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"valid", `{"type":"set_variable","key":"foo","value":"bar"}`, false},
		{"missing key", `{"type":"set_variable","value":"bar"}`, true},
		{"missing value", `{"type":"set_variable","key":"foo"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := action.ActionConfig{Type: "set_variable", Raw: json.RawMessage(tt.raw)}
			err := validateActionConfig(cfg)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateActionConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateActionConfig_UnknownType(t *testing.T) {
	cfg := action.ActionConfig{Type: "future_type", Raw: json.RawMessage(`{"type":"future_type"}`)}
	err := validateActionConfig(cfg)
	if err != nil {
		t.Errorf("unknown types should pass validation (forward-compatible), got error: %v", err)
	}
}
