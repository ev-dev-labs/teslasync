package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

func TestEvaluateTestConditions_Empty(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty conditions, got %d", len(results))
	}
}

func TestEvaluateTestConditions_NullConditions(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 0 {
		t.Errorf("expected 0 results for null conditions, got %d", len(results))
	}
}

func TestEvaluateTestConditions_InvalidJSON(t *testing.T) {
	h := &AutomationHandler{}
	a := &models.Automation{}
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 || results[0].Result != "unknown" {
		t.Errorf("expected 1 unknown result for invalid JSON, got %v", results)
	}
}

func TestEvaluateTestConditions_TimeWindowMet(t *testing.T) {
	h := &AutomationHandler{}
	// Build a time window that is currently active (00:00 - 23:59).
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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
	a := &models.Automation{}
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

// ── Import / Export Tests ───────────────────────────────────────────────

func TestAutomationToPortable(t *testing.T) {
	desc := "A test"
	a := &models.Automation{
		ID:        1,
		Name:      "Test Automation",
		Description: &desc,
		VehicleID: int64Ptr(42),
		Enabled:   true,
	}

	p := automationToPortable(a)

	if p.Name != a.Name {
		t.Errorf("Name = %q, want %q", p.Name, a.Name)
	}
	if p.Description != desc {
		t.Errorf("Description = %q, want %q", p.Description, desc)
	}
}

func TestAutomationToPortable_WebhookStripsSecrets(t *testing.T) {
	a := &models.Automation{
		Name: "Webhook Auto",
	}

	p := automationToPortable(a)

	if p.Name != "Webhook Auto" {
		t.Errorf("Name = %q, want %q", p.Name, "Webhook Auto")
	}
}

func TestScrubWebhookSecrets(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantKeys []string
		noKeys   []string
	}{
		{
			name:     "strips token and secret",
			input:    `{"webhook_token":"abc","secret":"xyz","payload_filter":"$.x"}`,
			wantKeys: []string{"payload_filter"},
			noKeys:   []string{"webhook_token", "secret"},
		},
		{
			name:     "handles missing fields gracefully",
			input:    `{"payload_filter":"$.x"}`,
			wantKeys: []string{"payload_filter"},
			noKeys:   []string{"webhook_token", "secret"},
		},
		{
			name:     "empty object",
			input:    `{}`,
			wantKeys: nil,
			noKeys:   []string{"webhook_token", "secret"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := scrubWebhookSecrets(json.RawMessage(tt.input))
			var m map[string]interface{}
			if err := json.Unmarshal(result, &m); err != nil {
				t.Fatalf("failed to unmarshal result: %v", err)
			}
			for _, k := range tt.wantKeys {
				if _, ok := m[k]; !ok {
					t.Errorf("expected key %q to be present", k)
				}
			}
			for _, k := range tt.noKeys {
				if _, ok := m[k]; ok {
					t.Errorf("key %q should have been stripped", k)
				}
			}
		})
	}
}

func TestScrubWebhookSecrets_InvalidJSON(t *testing.T) {
	raw := json.RawMessage(`{not valid}`)
	result := scrubWebhookSecrets(raw)
	if string(result) != string(raw) {
		t.Errorf("invalid JSON should return input unchanged, got %s", result)
	}
}

func TestInjectWebhookToken(t *testing.T) {
	raw := json.RawMessage(`{"payload_filter":"$.level"}`)
	result, token, err := injectWebhookToken(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty generated token")
	}

	var m map[string]interface{}
	if err := json.Unmarshal(result, &m); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if m["webhook_token"] != token {
		t.Errorf("webhook_token = %v, want %s", m["webhook_token"], token)
	}
	if m["payload_filter"] != "$.level" {
		t.Errorf("payload_filter should be preserved, got %v", m["payload_filter"])
	}
}

func TestInjectWebhookToken_InvalidJSON(t *testing.T) {
	raw := json.RawMessage(`{invalid`)
	_, _, err := injectWebhookToken(raw)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestBuildExportEnvelope(t *testing.T) {
	defs := []automationPortable{
		{Name: "Auto 1", TriggerType: "cron"},
		{Name: "Auto 2", TriggerType: "battery"},
	}

	env := buildExportEnvelope(defs)

	if env.Version != exportVersion {
		t.Errorf("Version = %d, want %d", env.Version, exportVersion)
	}
	if env.ExportedAt == "" {
		t.Error("ExportedAt should not be empty")
	}
	if _, err := time.Parse(time.RFC3339, env.ExportedAt); err != nil {
		t.Errorf("ExportedAt should be RFC3339, got %q: %v", env.ExportedAt, err)
	}
	if len(env.Automations) != 2 {
		t.Errorf("Automations count = %d, want 2", len(env.Automations))
	}
}

func TestExportEnvelope_RoundTrip(t *testing.T) {
	original := automationExportEnvelope{
		Version:    1,
		ExportedAt: "2026-04-18T12:00:00Z",
		Automations: []automationPortable{
			{
				Name:              "Morning Preheat",
				Description:       "Turn on climate at 8am",
				TriggerType:       "cron",
				TriggerConfig:     json.RawMessage(`{"cron_expr":"0 8 * * *","timezone":"America/New_York"}`),
				Conditions:        json.RawMessage(`[{"type":"time_window","start_time":"06:00","end_time":"22:00"}]`),
				Actions:           json.RawMessage(`[{"type":"command","command":"climate_on"}]`),
				CooldownMinutes:   60,
				MaxExecutionsHour: 1,
				StopOnFailure:     true,
				NotifyOnRun:       false,
				NotifyOnFailure:   true,
				SeasonalStart:     intPtr(10),
				SeasonalEnd:       intPtr(4),
				Priority:          25,
				Tags:              []string{"climate", "winter"},
			},
		},
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var restored automationExportEnvelope
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if restored.Version != original.Version {
		t.Errorf("Version mismatch: %d vs %d", restored.Version, original.Version)
	}
	if len(restored.Automations) != 1 {
		t.Fatalf("Automations count = %d, want 1", len(restored.Automations))
	}

	a := restored.Automations[0]
	if a.Name != "Morning Preheat" {
		t.Errorf("Name = %q, want %q", a.Name, "Morning Preheat")
	}
	if a.TriggerType != "cron" {
		t.Errorf("TriggerType = %q, want %q", a.TriggerType, "cron")
	}
	if a.CooldownMinutes != 60 {
		t.Errorf("CooldownMinutes = %d, want 60", a.CooldownMinutes)
	}
	if *a.SeasonalStart != 10 || *a.SeasonalEnd != 4 {
		t.Errorf("Seasonal = %v-%v, want 10-4", a.SeasonalStart, a.SeasonalEnd)
	}
	if len(a.Tags) != 2 || a.Tags[0] != "climate" || a.Tags[1] != "winter" {
		t.Errorf("Tags = %v, want [climate, winter]", a.Tags)
	}
}

func TestWriteJSONIndent(t *testing.T) {
	// Ensure the output is indented (human-readable for sharing).
	data := map[string]string{"key": "value"}
	rec := httptest.NewRecorder()
	writeJSONIndent(rec, 200, data)
	body := rec.Body.String()
	if !containsSubstring(body, "  ") {
		t.Errorf("expected indented JSON output, got: %s", body)
	}
	if rec.Code != 200 {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

// ── test helpers ────────────────────────────────────────────────────────

func int64Ptr(v int64) *int64 { return &v }

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && searchSubstring(s, sub)
}

func searchSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// ── Undo tests ─────────────────────────────────────────────────────────

func TestReverseCommands_Symmetry(t *testing.T) {
	// Every entry in reverseCommands should have a corresponding reverse entry
	// (i.e., reverse(reverse(cmd)) == cmd), except for one-way entries like
	// dog_mode/camp_mode which map to climate_keeper_off.
	oneWay := map[string]bool{
		"dog_mode":  true,
		"camp_mode": true,
	}

	for cmd, rev := range reverseCommands {
		if oneWay[cmd] {
			continue
		}
		reverseOfReverse, ok := reverseCommands[rev]
		if !ok {
			t.Errorf("reverseCommands[%q] = %q, but %q has no reverse entry", cmd, rev, rev)
			continue
		}
		if reverseOfReverse != cmd {
			t.Errorf("reverseCommands[reverseCommands[%q]] = %q, want %q", cmd, reverseOfReverse, cmd)
		}
	}
}

func TestReverseCommands_AllAreKnownTeslaCommands(t *testing.T) {
	// Both keys and values should be recognized Tesla commands.
	for cmd, rev := range reverseCommands {
		if !tesla.IsKnownCommand(cmd) {
			t.Errorf("reverseCommands key %q is not a known Tesla command", cmd)
		}
		if !tesla.IsKnownCommand(rev) {
			t.Errorf("reverseCommands value %q (reverse of %q) is not a known Tesla command", rev, cmd)
		}
	}
}

func TestUndoLast_NilExecutor_Returns501(t *testing.T) {
	h := &AutomationHandler{} // no cmdExecutor
	req := httptest.NewRequest("POST", "/automations/1/undo", nil)
	rec := httptest.NewRecorder()
	h.UndoLast(rec, req)
	if rec.Code != 501 {
		t.Errorf("status = %d, want 501", rec.Code)
	}
}
