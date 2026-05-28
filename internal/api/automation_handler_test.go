package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	dbauto "github.com/ev-dev-labs/teslasync/internal/database/automation"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

func TestAutomationDTOContract_AcceptsTypedCreateAndUpdateFields(t *testing.T) {
	req, err := decodeAutomationInputDTO(strings.NewReader(validAutomationDTOPayload()))
	if err != nil {
		t.Fatalf("decodeAutomationInputDTO() unexpected error: %v", err)
	}
	if req.Name != "Typed Automation" {
		t.Fatalf("Name = %q, want Typed Automation", req.Name)
	}
	if req.VehicleID == nil || *req.VehicleID != 42 {
		t.Fatalf("VehicleID = %v, want 42", req.VehicleID)
	}
	if req.Enabled == nil || !*req.Enabled {
		t.Fatalf("Enabled = %v, want true", req.Enabled)
	}
	if len(req.Triggers) != 4 {
		t.Fatalf("Triggers count = %d, want 4", len(req.Triggers))
	}
	if len(req.Conditions) != 4 {
		t.Fatalf("Conditions count = %d, want 4", len(req.Conditions))
	}
	if len(req.Actions) != 4 {
		t.Fatalf("Actions count = %d, want 4", len(req.Actions))
	}
	if req.Triggers[0].Kind != models.AutomationStepKindTriggerSignal ||
		req.Triggers[1].Kind != models.AutomationStepKindTriggerGeofence ||
		req.Triggers[2].Kind != models.AutomationStepKindTriggerSchedule ||
		req.Triggers[3].Kind != models.AutomationStepKindTriggerEvent {
		t.Fatalf("trigger kinds = %#v", req.Triggers)
	}
	schedule, ok := req.Triggers[2].Payload.(automationTriggerScheduleDTO)
	if !ok {
		t.Fatalf("schedule payload type = %T", req.Triggers[2].Payload)
	}
	if schedule.Timezone != "UTC" {
		t.Fatalf("schedule timezone = %q, want UTC default", schedule.Timezone)
	}
	if req.Conditions[3].Kind != models.AutomationStepKindConditionOtherAutomation {
		t.Fatalf("condition[3] kind = %q", req.Conditions[3].Kind)
	}
	if req.Actions[1].Kind != models.AutomationStepKindActionNotify ||
		req.Actions[3].Kind != models.AutomationStepKindActionCallAutomation {
		t.Fatalf("action kinds = %#v", req.Actions)
	}
}

func TestAutomationDTOValidation_RejectsFrontendAliases(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{"trigger_time", automationPayloadWithTrigger(`{"kind":"trigger_time","cron_expr":"0 8 * * *","timezone":"UTC"}`)},
		{"trigger_webhook", automationPayloadWithTrigger(`{"kind":"trigger_webhook","webhook_token":"abc","require_signature":false}`)},
		{"condition_day_of_week", automationPayloadWithCondition(`{"kind":"condition_day_of_week","days_of_week":[1],"timezone":"UTC"}`)},
		{"action_notification", automationPayloadWithAction(`{"kind":"action_notification","channel_id":1,"template":"hi"}`)},
		{"action_vehicle_command", automationPayloadWithAction(`{"kind":"action_vehicle_command","command":"lock","command_params":{}}`)},
		{"action_set_state", automationPayloadWithAction(`{"kind":"action_set_state","state_key":"mode","state_value":"away"}`)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := decodeAutomationInputDTO(strings.NewReader(tt.payload)); err == nil {
				t.Fatalf("expected alias %s to be rejected", tt.name)
			}
		})
	}
}

func TestAutomationDTOValidation_RejectsLegacyFields(t *testing.T) {
	tests := []struct {
		field string
		value string
	}{
		{"trigger_type", `"cron"`},
		{"trigger_config", `{}`},
		{"notify_channels", `[]`},
		{"cooldown_minutes", `10`},
		{"max_executions_hour", `1`},
		{"seasonal_start", `1`},
		{"seasonal_end", `12`},
		{"priority", `5`},
		{"tags", `["legacy"]`},
		{"preset_id", `"morning-preheat"`},
	}
	for _, tt := range tests {
		t.Run(tt.field, func(t *testing.T) {
			payload := injectAutomationRootField(validAutomationDTOPayload(), tt.field, tt.value)
			if _, err := decodeAutomationInputDTO(strings.NewReader(payload)); err == nil {
				t.Fatalf("expected legacy field %s to be rejected", tt.field)
			}
		})
	}
	t.Run("root JSON action blobs", func(t *testing.T) {
		payload := automationPayloadWithAction(`{"type":"command","command":"lock"}`)
		if _, err := decodeAutomationInputDTO(strings.NewReader(payload)); err == nil {
			t.Fatal("expected legacy root JSON action blob to be rejected")
		}
	})
}

func TestAutomationDTOValidation_RejectsUnknownFields(t *testing.T) {
	t.Run("root", func(t *testing.T) {
		payload := injectAutomationRootField(validAutomationDTOPayload(), "unexpected", `true`)
		if _, err := decodeAutomationInputDTO(strings.NewReader(payload)); err == nil {
			t.Fatal("expected unknown root field to be rejected")
		}
	})
	t.Run("step", func(t *testing.T) {
		payload := automationPayloadWithTrigger(`{"kind":"trigger_signal","signal":"BatteryLevel","op":">","value_num":80,"signal_name":"legacy"}`)
		if _, err := decodeAutomationInputDTO(strings.NewReader(payload)); err == nil {
			t.Fatal("expected unknown step field to be rejected")
		}
	})
}

func TestAutomationDTOValidation_RejectsInvalidStepPayloads(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{"trigger_signal missing value", automationPayloadWithTrigger(`{"kind":"trigger_signal","signal":"BatteryLevel","op":">"}`)},
		{"trigger_signal changed with value", automationPayloadWithTrigger(`{"kind":"trigger_signal","signal":"BatteryLevel","op":"changed","value_num":80}`)},
		{"trigger_geofence dwell minutes on enter", automationPayloadWithTrigger(`{"kind":"trigger_geofence","place_id":1,"event":"enter","dwell_minutes":5}`)},
		{"condition_signal between missing max", automationPayloadWithCondition(`{"kind":"condition_signal","signal":"BatteryLevel","op":"between","value_min":20}`)},
		{"action_set_setting multiple values", automationPayloadWithAction(`{"kind":"action_set_setting","setting_key":"charge_limit","value_num":80,"value_bool":true}`)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := decodeAutomationInputDTO(strings.NewReader(tt.payload)); err == nil {
				t.Fatalf("expected invalid payload %q to be rejected", tt.name)
			}
		})
	}
}

func TestAutomationPersistenceRollbackOnChildStepError(t *testing.T) {
	repo := &automationPersistenceFakeRepo{failKind: models.AutomationStepKindActionNotify}
	h := &AutomationHandler{repo: repo}
	req := httptest.NewRequest(http.MethodPost, "/automations", strings.NewReader(validAutomationDTOPayload()))
	rec := httptest.NewRecorder()

	h.Create(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if repo.createCalled {
		t.Fatal("Create used non-transactional parent-only persistence path")
	}
	if repo.committedParent != nil {
		t.Fatalf("parent committed after child-step error: %#v", repo.committedParent)
	}
	if len(repo.committedSteps) != 0 {
		t.Fatalf("steps committed after child-step error: %#v", repo.committedSteps)
	}
	if repo.stagedParent == nil {
		t.Fatal("expected parent row to be staged before forced child-step error")
	}
	if len(repo.stagedSteps) == 0 {
		t.Fatal("expected prior new steps to be staged before forced child-step error")
	}
}

func TestAutomationImportContract_RejectsOldJSONAutomationPayloads(t *testing.T) {
	body := `{
		"version": 1,
		"exported_at": "2026-04-18T12:00:00Z",
		"automations": [{
			"name": "Legacy",
			"description": "old",
			"trigger_type": "cron",
			"trigger_config": {"cron_expr":"0 8 * * *"},
			"conditions": [],
			"actions": [{"type":"command","command":"lock"}],
			"cooldown_minutes": 60,
			"priority": 10
		}]
	}`
	h := &AutomationHandler{}
	req := httptest.NewRequest("POST", "/automations/import", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Import(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestAutomationImportExportContract_TypedStepArraysRoundTrip(t *testing.T) {
	enabled := true
	original := automationExportEnvelope{
		Version:    1,
		ExportedAt: "2026-04-18T12:00:00Z",
		Automations: []automationPortable{
			{
				Name:        "Morning Preheat",
				Description: "Turn on climate at 8am",
				Enabled:     &enabled,
				Triggers: []json.RawMessage{
					json.RawMessage(`{"kind":"trigger_schedule","cron_expr":"0 8 * * *","timezone":"America/New_York"}`),
				},
				Conditions: []json.RawMessage{
					json.RawMessage(`{"kind":"condition_time_window","start_time":"06:00","end_time":"22:00","timezone":"America/New_York","days_of_week":[1,2,3,4,5]}`),
				},
				Actions: []json.RawMessage{
					json.RawMessage(`{"kind":"action_command","command_name":"climate_on","command_params":{"temperature":21}}`),
					json.RawMessage(`{"kind":"action_notify","channel_id":7,"template":"Preheat started"}`),
				},
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
	if len(restored.Automations) != 1 {
		t.Fatalf("Automations count = %d, want 1", len(restored.Automations))
	}
	req, err := validateAutomationPortable(restored.Automations[0])
	if err != nil {
		t.Fatalf("validateAutomationPortable() unexpected error: %v", err)
	}
	if len(req.Triggers) != 1 || req.Triggers[0].Kind != models.AutomationStepKindTriggerSchedule {
		t.Fatalf("triggers = %#v", req.Triggers)
	}
	if len(req.Actions) != 2 || req.Actions[0].Kind != models.AutomationStepKindActionCommand {
		t.Fatalf("actions = %#v", req.Actions)
	}

	repo := &automationPersistenceFakeRepo{}
	h := &AutomationHandler{repo: repo}
	httpReq := httptest.NewRequest(http.MethodPost, "/automations/import", strings.NewReader(string(data)))
	rec := httptest.NewRecorder()
	h.Import(rec, httpReq)
	if rec.Code != http.StatusCreated {
		t.Fatalf("import status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if repo.committedParent == nil {
		t.Fatal("expected imported parent to be persisted")
	}
	if repo.committedParent.Enabled {
		t.Fatal("imported automation must start disabled")
	}
	if len(repo.committedSteps) != 4 {
		t.Fatalf("imported typed steps = %d, want 4", len(repo.committedSteps))
	}
	if repo.committedSteps[0].Kind != models.AutomationStepKindTriggerSchedule ||
		repo.committedSteps[1].Kind != models.AutomationStepKindConditionTimeWindow ||
		repo.committedSteps[2].Kind != models.AutomationStepKindActionCommand ||
		repo.committedSteps[3].Kind != models.AutomationStepKindActionNotify {
		t.Fatalf("imported step order = %#v", repo.committedSteps)
	}
}

func TestEvaluateTestConditions_Empty(t *testing.T) {
	h := &AutomationHandler{}
	a := testAutomationFull()
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty conditions, got %d", len(results))
	}
}

func TestEvaluateTestConditions_NullConditions(t *testing.T) {
	h := &AutomationHandler{}
	a := testAutomationFull()
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 0 {
		t.Errorf("expected 0 results for null conditions, got %d", len(results))
	}
}

func TestEvaluateTestConditions_InvalidJSON(t *testing.T) {
	h := &AutomationHandler{}
	a := testAutomationFullWithConditions(`{not json}`)
	results := h.evaluateTestConditions(a, time.Now().UTC())
	if len(results) != 1 || results[0].Result != "unknown" {
		t.Errorf("expected 1 unknown result for invalid JSON, got %v", results)
	}
}

func TestEvaluateTestConditions_TimeWindowMet(t *testing.T) {
	h := &AutomationHandler{}
	// Build a time window that is currently active (00:00 - 23:59).
	a := testAutomationFullWithConditions(`{"type":"time_window","start_time":"00:00","end_time":"23:59","timezone":"UTC"}`)
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
	a := testAutomationFullWithConditions(`{"type":"time_window","start_time":"01:00","end_time":"02:00","timezone":"UTC"}`)
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
	a := testAutomationFullWithConditions(`{"type":"day_filter","days":[6],"timezone":"UTC"}`)
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
	a := testAutomationFullWithConditions(`{"type":"seasonal","start_month":3,"end_month":9}`)
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
	a := testAutomationFullWithCreatedAt(now.Add(-2*time.Hour), `{"type":"cooldown","minutes":30}`)
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
	a := testAutomationFullWithCreatedAt(now.Add(-5*time.Minute), `{"type":"cooldown","minutes":30}`)
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
	a := testAutomationFullWithConditions(`{"type":"state_check","field":"state","operator":"eq","value":"online"}`)
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
	a := testAutomationFullWithConditions(`{"type":"location","geofence_id":1,"operator":"inside"}`)
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
	a := testAutomationFullWithConditions(`{"type":"variable_check","key":"foo","operator":"eq","value":"bar"}`)
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
	a := testAutomationFullWithConditions(
		`{"type":"time_window","start_time":"00:00","end_time":"23:59","timezone":"UTC"}`,
		`{"type":"state_check","field":"state","operator":"eq","value":"online"}`,
		`{"type":"seasonal","start_month":3,"end_month":9}`,
	)
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
	a := testAutomationFull()
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
	a := testAutomationFullWithActions(`{"type":"command","command":"lock"}`)
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
	a := testAutomationFullWithActions(`{"type":"command","command":"fly_to_mars"}`)
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
	a := testAutomationFullWithActions(
		`{"type":"command","command":"lock"}`,
		`{"type":"wait","duration_seconds":10}`,
	)
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
	a := testAutomationFullWithActions(
		`{"type":"command","command":"fly_to_mars"}`,
		`{"type":"command","command":"lock"}`,
	)
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
	a := testAutomationFullWithActions(
		`{"type":"command","command":"lock"}`,
		`{"type":"wait","duration_seconds":10}`,
		`{"type":"notify","channel":"all","message":"hello"}`,
		`{"type":"set_variable","key":"foo","value":"bar"}`,
	)
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

func TestAutomationExportContract_EmitsTypedStepArrays(t *testing.T) {
	desc := "A test"
	start, err := parseAutomationClockTime("06:00")
	if err != nil {
		t.Fatalf("start time: %v", err)
	}
	end, err := parseAutomationClockTime("22:00")
	if err != nil {
		t.Fatalf("end time: %v", err)
	}
	full := &models.AutomationFull{
		Automation: models.Automation{
			ID:          1,
			Name:        "Test Automation",
			Description: &desc,
			VehicleID:   int64Ptr(42),
			Enabled:     true,
		},
		Steps: []models.AutomationStep{
			{ID: 10, AutomationID: 1, StepOrder: 1, Kind: models.AutomationStepKindTriggerSchedule},
			{ID: 11, AutomationID: 1, StepOrder: 2, Kind: models.AutomationStepKindConditionTimeWindow},
			{ID: 12, AutomationID: 1, StepOrder: 3, Kind: models.AutomationStepKindActionCommand},
		},
	}
	payloads := newAutomationExportPayloads()
	payloads.triggers[10] = &models.AutomationStepTriggerSchedule{
		StepID:   10,
		CronExpr: "0 8 * * *",
		Timezone: "UTC",
	}
	payloads.conditions[11] = &models.AutomationStepConditionTimeWindow{
		StepID:     11,
		StartTime:  start,
		EndTime:    end,
		Timezone:   "UTC",
		DaysOfWeek: []int16{1, 2, 3, 4, 5},
	}
	payloads.actions[12] = &models.AutomationAction{
		StepID:        12,
		CommandName:   "climate_on",
		CommandParams: json.RawMessage(`{"temperature":21}`),
	}

	p, err := automationToPortable(full, payloads)
	if err != nil {
		t.Fatalf("automationToPortable() unexpected error: %v", err)
	}

	if p.Name != full.Name {
		t.Errorf("Name = %q, want %q", p.Name, full.Name)
	}
	if p.Description != desc {
		t.Errorf("Description = %q, want %q", p.Description, desc)
	}
	if len(p.Triggers) != 1 || len(p.Conditions) != 1 || len(p.Actions) != 1 {
		t.Fatalf("typed step counts = triggers:%d conditions:%d actions:%d", len(p.Triggers), len(p.Conditions), len(p.Actions))
	}
	var trigger automationTriggerScheduleDTO
	if err := json.Unmarshal(p.Triggers[0], &trigger); err != nil {
		t.Fatalf("trigger unmarshal: %v", err)
	}
	if trigger.Kind != models.AutomationStepKindTriggerSchedule || trigger.StepOrder == nil || *trigger.StepOrder != 1 {
		t.Fatalf("trigger export = %#v", trigger)
	}
	var condition automationConditionTimeWindowDTO
	if err := json.Unmarshal(p.Conditions[0], &condition); err != nil {
		t.Fatalf("condition unmarshal: %v", err)
	}
	if condition.StartTime != "06:00:00" || condition.EndTime != "22:00:00" || len(condition.DaysOfWeek) != 5 {
		t.Fatalf("condition export = %#v", condition)
	}
	var action automationActionCommandDTO
	if err := json.Unmarshal(p.Actions[0], &action); err != nil {
		t.Fatalf("action unmarshal: %v", err)
	}
	if action.Kind != models.AutomationStepKindActionCommand || action.CommandName != "climate_on" {
		t.Fatalf("action export = %#v", action)
	}
	if _, err := validateAutomationPortable(p); err != nil {
		t.Fatalf("exported typed payload did not validate for import: %v", err)
	}
}

func TestAutomationExportContract_EmptyStepsUseTypedArrays(t *testing.T) {
	full := &models.AutomationFull{
		Automation: models.Automation{
			Name: "Empty Auto",
		},
	}

	p, err := automationToPortable(full, newAutomationExportPayloads())
	if err != nil {
		t.Fatalf("automationToPortable() unexpected error: %v", err)
	}

	if p.Name != "Empty Auto" {
		t.Errorf("Name = %q, want %q", p.Name, "Empty Auto")
	}
	if p.Triggers == nil || p.Conditions == nil || p.Actions == nil {
		t.Fatalf("typed arrays must be present, got triggers:%v conditions:%v actions:%v", p.Triggers, p.Conditions, p.Actions)
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
		{Name: "Auto 1", Triggers: []json.RawMessage{json.RawMessage(`{"kind":"trigger_schedule","cron_expr":"0 8 * * *"}`)}},
		{Name: "Auto 2", Triggers: []json.RawMessage{json.RawMessage(`{"kind":"trigger_event","event_type":"drive_start"}`)}},
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
	enabled := true
	original := automationExportEnvelope{
		Version:    1,
		ExportedAt: "2026-04-18T12:00:00Z",
		Automations: []automationPortable{
			{
				Name:        "Morning Preheat",
				Description: "Turn on climate at 8am",
				Enabled:     &enabled,
				Triggers: []json.RawMessage{
					json.RawMessage(`{"kind":"trigger_schedule","cron_expr":"0 8 * * *","timezone":"America/New_York"}`),
				},
				Conditions: []json.RawMessage{
					json.RawMessage(`{"kind":"condition_time_window","start_time":"06:00","end_time":"22:00"}`),
				},
				Actions: []json.RawMessage{
					json.RawMessage(`{"kind":"action_command","command_name":"climate_on","command_params":{}}`),
				},
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
	if a.Enabled == nil || !*a.Enabled {
		t.Errorf("Enabled = %v, want true", a.Enabled)
	}
	if len(a.Triggers) != 1 || !containsSubstring(string(a.Triggers[0]), "trigger_schedule") {
		t.Errorf("Triggers = %v, want trigger_schedule", a.Triggers)
	}
	if len(a.Conditions) != 1 || !containsSubstring(string(a.Conditions[0]), "condition_time_window") {
		t.Errorf("Conditions = %v, want condition_time_window", a.Conditions)
	}
	if len(a.Actions) != 1 || !containsSubstring(string(a.Actions[0]), "action_command") {
		t.Errorf("Actions = %v, want action_command", a.Actions)
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

type automationPersistenceFakeRepo struct {
	failKind        string
	createCalled    bool
	stagedParent    *models.Automation
	stagedSteps     []dbauto.AutomationStepWrite
	committedParent *models.Automation
	committedSteps  []dbauto.AutomationStepWrite
}

func (r *automationPersistenceFakeRepo) ListFull(context.Context) ([]models.AutomationFull, error) {
	return nil, nil
}

func (r *automationPersistenceFakeRepo) GetByID(context.Context, int64) (*models.AutomationFull, error) {
	return nil, nil
}

func (r *automationPersistenceFakeRepo) Create(context.Context, *models.Automation) error {
	r.createCalled = true
	return fmt.Errorf("unexpected non-transactional create")
}

func (r *automationPersistenceFakeRepo) CreateWithSteps(_ context.Context, a *models.Automation, steps []dbauto.AutomationStepWrite) error {
	stagedParent := *a
	stagedParent.ID = 101
	r.stagedParent = &stagedParent
	r.stagedSteps = r.stagedSteps[:0]

	for _, step := range steps {
		if step.Kind == r.failKind {
			return fmt.Errorf("forced child-step persistence error for %s", step.Kind)
		}
		r.stagedSteps = append(r.stagedSteps, step)
	}

	a.ID = stagedParent.ID
	committedParent := stagedParent
	r.committedParent = &committedParent
	r.committedSteps = append([]dbauto.AutomationStepWrite(nil), r.stagedSteps...)
	return nil
}

func (r *automationPersistenceFakeRepo) Update(context.Context, *models.Automation) error {
	return nil
}

func (r *automationPersistenceFakeRepo) UpdateWithSteps(context.Context, *models.Automation, []dbauto.AutomationStepWrite) error {
	return nil
}

func (r *automationPersistenceFakeRepo) Delete(context.Context, int64) error {
	return nil
}

func int64Ptr(v int64) *int64 { return &v }

func validAutomationDTOPayload() string {
	return `{
		"name": "Typed Automation",
		"description": "A typed automation",
		"enabled": true,
		"vehicle_id": 42,
		"triggers": [
			{"kind":"trigger_signal","signal":"BatteryLevel","op":">","value_num":80},
			{"kind":"trigger_geofence","place_id":1,"event":"dwell","dwell_minutes":10},
			{"kind":"trigger_schedule","cron_expr":"0 8 * * *"},
			{"kind":"trigger_event","event_type":"drive_start"}
		],
		"conditions": [
			{"kind":"condition_signal","signal":"InsideTemp","op":"between","value_min":10,"value_max":30},
			{"kind":"condition_time_window","start_time":"07:00","end_time":"09:00","timezone":"UTC","days_of_week":[1,2,3]},
			{"kind":"condition_geofence","place_id":1,"state":"inside"},
			{"kind":"condition_other_automation","other_automation_id":2,"state":"enabled"}
		],
		"actions": [
			{"kind":"action_command","command_name":"climate_on","command_params":{"temperature":21}},
			{"kind":"action_notify","channel_id":5,"template":"Hello"},
			{"kind":"action_set_setting","setting_key":"charge_limit","value_num":80},
			{"kind":"action_call_automation","target_automation_id":7}
		]
	}`
}

func automationPayloadWithTrigger(trigger string) string {
	return fmt.Sprintf(`{
		"name": "Typed Automation",
		"description": "A typed automation",
		"enabled": true,
		"vehicle_id": 42,
		"triggers": [%s],
		"conditions": [],
		"actions": [{"kind":"action_command","command_name":"lock","command_params":{}}]
	}`, trigger)
}

func automationPayloadWithCondition(condition string) string {
	return fmt.Sprintf(`{
		"name": "Typed Automation",
		"description": "A typed automation",
		"enabled": true,
		"vehicle_id": 42,
		"triggers": [{"kind":"trigger_schedule","cron_expr":"0 8 * * *","timezone":"UTC"}],
		"conditions": [%s],
		"actions": [{"kind":"action_command","command_name":"lock","command_params":{}}]
	}`, condition)
}

func automationPayloadWithAction(action string) string {
	return fmt.Sprintf(`{
		"name": "Typed Automation",
		"description": "A typed automation",
		"enabled": true,
		"vehicle_id": 42,
		"triggers": [{"kind":"trigger_schedule","cron_expr":"0 8 * * *","timezone":"UTC"}],
		"conditions": [],
		"actions": [%s]
	}`, action)
}

func injectAutomationRootField(payload, field, value string) string {
	return strings.Replace(payload, `"actions":`, fmt.Sprintf(`"%s": %s, "actions":`, field, value), 1)
}

func testAutomationFull() *models.AutomationFull {
	return &models.AutomationFull{
		Automation: models.Automation{
			CreatedAt: time.Now().UTC(),
		},
	}
}

func testAutomationFullWithCreatedAt(createdAt time.Time, conditions ...string) *models.AutomationFull {
	a := testAutomationFullWithConditions(conditions...)
	a.CreatedAt = createdAt
	return a
}

func testAutomationFullWithConditions(conditions ...string) *models.AutomationFull {
	a := testAutomationFull()
	for _, condition := range conditions {
		a.Conditions = append(a.Conditions, json.RawMessage(condition))
	}
	return a
}

func testAutomationFullWithActions(actions ...string) *models.AutomationFull {
	a := testAutomationFull()
	for _, action := range actions {
		a.Actions = append(a.Actions, json.RawMessage(action))
	}
	return a
}

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
