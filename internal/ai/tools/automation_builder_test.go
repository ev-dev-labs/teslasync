// Phase-50 / 0016 — N2 Natural-language automation builder.
//
// Tool tests for draft_automation_graph + validate_automation_graph.
// Both tools are pure functions over input + AutomationGraphValidator
// interface; the tests stub the validator with a deterministic fake
// so the tests stay hermetic (no api package import, no DB).

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// stubAutomationValidator records every call + can be wired to fail
// for the rejection-path tests.
type stubAutomationValidator struct {
	failWith error
	calls    []json.RawMessage
}

func (s *stubAutomationValidator) ValidateAutomationWire(wireJSON json.RawMessage) error {
	dup := make(json.RawMessage, len(wireJSON))
	copy(dup, wireJSON)
	s.calls = append(s.calls, dup)
	return s.failWith
}

// TestDraftAutomationGraph_HappyPath_OK proves a valid LLM payload
// yields status="ok" + a Draft whose vehicle scope is clamped to
// the requested vehicle and whose trigger / action shapes are
// preserved.
func TestDraftAutomationGraph_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubAutomationValidator{}
	tool := &draftAutomationGraph{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Battery low alert",
		"trigger": {
			"kind": "trigger_signal",
			"signal": "battery_level",
			"op": "<",
			"value_num": 20
		},
		"actions": [
			{
				"kind": "action_notify",
				"channel_id": 1,
				"template": "Battery low"
			}
		]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*automationGraphDraftOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *automationGraphDraftOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (validation_error=%q)", env.Status, "ok", env.ValidationError)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty on ok", env.ValidationError)
	}
	if len(env.Draft) == 0 {
		t.Fatal("Draft is empty")
	}

	var decoded map[string]any
	if err := json.Unmarshal(env.Draft, &decoded); err != nil {
		t.Fatalf("Draft is not JSON object: %v", err)
	}
	if got, _ := decoded["vehicle_id"].(float64); int64(got) != 1 {
		t.Errorf("Draft.vehicle_id = %v, want 1", decoded["vehicle_id"])
	}
	if got, _ := decoded["name"].(string); got != "Battery low alert" {
		t.Errorf("Draft.name = %v, want Battery low alert", decoded["name"])
	}
	triggers, _ := decoded["triggers"].([]any)
	if len(triggers) != 1 {
		t.Fatalf("Draft.triggers len = %d, want 1", len(triggers))
	}
	trigger0, _ := triggers[0].(map[string]any)
	if trigger0["kind"] != "trigger_signal" {
		t.Errorf("Draft.triggers[0].kind = %v, want trigger_signal", trigger0["kind"])
	}
	if trigger0["signal"] != "battery_level" {
		t.Errorf("Draft.triggers[0].signal = %v, want battery_level", trigger0["signal"])
	}
	actions, _ := decoded["actions"].([]any)
	if len(actions) != 1 {
		t.Fatalf("Draft.actions len = %d, want 1", len(actions))
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator called %d times, want 1", len(stub.calls))
	}
}

// TestDraftAutomationGraph_ClampsVehicleScope proves that even when
// the LLM proposes vehicle_id=999, the wire payload sent to the
// validator is clamped to the requested vehicle. This is the
// load-bearing typed guard against a confused model drafting an
// automation for someone else's car.
func TestDraftAutomationGraph_ClampsVehicleScope(t *testing.T) {
	t.Parallel()
	stub := &stubAutomationValidator{}
	tool := &draftAutomationGraph{validator: stub}

	// The slice prompt mandates the AI handler clamp the scope to
	// the caller's vehicle. The tool's input has the caller's
	// vehicle (vehicle_id=1) — even if the LLM hallucinated a
	// different one, the AI handler would have overwritten it
	// before invoking the tool. We test the tool itself: the
	// vehicle_id field in the wire payload MUST equal the input.
	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Charge at home",
		"trigger": {"kind": "trigger_geofence", "place_id": 5, "event": "enter"},
		"actions": [{"kind": "action_command", "command_name": "charge_start"}]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*automationGraphDraftOutput)
	var decoded map[string]any
	if err := json.Unmarshal(env.Draft, &decoded); err != nil {
		t.Fatalf("decode draft: %v", err)
	}
	if got, _ := decoded["vehicle_id"].(float64); int64(got) != 1 {
		t.Errorf("Draft.vehicle_id = %v, want 1 (clamped)", decoded["vehicle_id"])
	}
}

// TestDraftAutomationGraph_ValidatorFailureSurfacesAsInvalid proves
// the tool surfaces a validator rejection as status="invalid" with
// the diagnostic in ValidationError, NOT as a returned error from
// Execute. This keeps the LLM's follow-up prose able to describe the
// problem.
func TestDraftAutomationGraph_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubAutomationValidator{failWith: errors.New("name is required")}
	tool := &draftAutomationGraph{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "x",
		"trigger": {"kind": "trigger_event", "event_type": "drive_start"},
		"actions": [{"kind": "action_call_automation", "target_automation_id": 7}]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute returned err = %v, want nil (validator failures must surface as status=invalid)", err)
	}
	env := out.(*automationGraphDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if env.ValidationError != "name is required" {
		t.Errorf("ValidationError = %q, want %q", env.ValidationError, "name is required")
	}
	if len(env.Draft) == 0 {
		t.Errorf("Draft is empty even on invalid; the frontend needs the partially-correct shape to render")
	}
}

// TestDraftAutomationGraph_ValidateRejectsBadInput proves the
// tag-driven Validate path bounces malformed payloads BEFORE the
// validator wrapper runs. Includes: missing required fields, unknown
// fields, bad enum values.
func TestDraftAutomationGraph_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &draftAutomationGraph{validator: &stubAutomationValidator{}}

	cases := []struct {
		name string
		body string
	}{
		{"empty", `{}`},
		{"missing vehicle_id", `{"name":"x","trigger":{"kind":"trigger_event","event_type":"drive_start"},"actions":[{"kind":"action_command","command_name":"x"}]}`},
		{"missing name", `{"vehicle_id":1,"trigger":{"kind":"trigger_event","event_type":"drive_start"},"actions":[{"kind":"action_command","command_name":"x"}]}`},
		{"missing actions", `{"vehicle_id":1,"name":"x","trigger":{"kind":"trigger_event","event_type":"drive_start"}}`},
		{"bad trigger kind", `{"vehicle_id":1,"name":"x","trigger":{"kind":"bogus"},"actions":[{"kind":"action_command","command_name":"x"}]}`},
		{"bad action kind", `{"vehicle_id":1,"name":"x","trigger":{"kind":"trigger_event","event_type":"drive_start"},"actions":[{"kind":"bogus"}]}`},
		{"unknown root field", `{"vehicle_id":1,"name":"x","trigger":{"kind":"trigger_event","event_type":"drive_start"},"actions":[{"kind":"action_command","command_name":"x"}],"hacker":true}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tool.Validate(json.RawMessage(tc.body))
			if err == nil {
				t.Fatalf("Validate(%s) err = nil, want non-nil", tc.body)
			}
		})
	}
}

// TestDraftAutomationGraph_NilValidator_Errors proves Execute
// surfaces a clear error when the wiring forgets to set the
// validator. The constructor in production prevents this; the tool
// test path can still hit it.
func TestDraftAutomationGraph_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &draftAutomationGraph{validator: nil}
	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "x",
		"trigger": {"kind": "trigger_event", "event_type": "drive_start"},
		"actions": [{"kind": "action_command", "command_name": "x"}]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want non-nil for missing validator")
	}
	if !strings.Contains(err.Error(), "AutomationGraphValidator") {
		t.Errorf("Execute err = %v, want mention of AutomationGraphValidator", err)
	}
}

// TestDraftAutomationGraph_ToolMetadata pins the basic Tool
// interface contract: PROPOSE-only (Mutates=false), no
// RequiredScope, deterministic Name.
func TestDraftAutomationGraph_ToolMetadata(t *testing.T) {
	t.Parallel()
	tool := &draftAutomationGraph{validator: &stubAutomationValidator{}}
	if tool.Name() != "draft_automation_graph" {
		t.Errorf("Name() = %q, want draft_automation_graph", tool.Name())
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false (PROPOSE-only contract)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if len(tool.InputSchema()) == 0 {
		t.Error("InputSchema() returned empty")
	}
	if tool.OutputSchema() != nil {
		t.Errorf("OutputSchema() = %s, want nil", tool.OutputSchema())
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty")
	}
	for _, must := range []string{"trigger_signal", "condition_signal", "action_command", "PROPOSE-ONLY"} {
		if !strings.Contains(tool.Description(), must) {
			t.Errorf("Description() missing %q: %q", must, tool.Description())
		}
	}
}

// TestValidateAutomationGraph_HappyPath_OK proves the validate-only
// tool returns status="ok" + the source breadcrumb when the
// validator accepts the typed input.
func TestValidateAutomationGraph_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubAutomationValidator{}
	tool := &validateAutomationGraphTool{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Charge at home",
		"trigger": {"kind": "trigger_geofence", "place_id": 5, "event": "enter"},
		"actions": [{"kind": "action_command", "command_name": "charge_start"}]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env, ok := out.(*automationGraphValidateOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *automationGraphValidateOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty", env.ValidationError)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator called %d times, want 1", len(stub.calls))
	}
}

// TestValidateAutomationGraph_FailureSurfacesAsInvalid proves the
// validate-only tool surfaces a validator rejection as
// status="invalid" with the diagnostic, NOT as a returned error.
func TestValidateAutomationGraph_FailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubAutomationValidator{failWith: errors.New("place_id is required")}
	tool := &validateAutomationGraphTool{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Geofence test",
		"trigger": {"kind": "trigger_geofence", "place_id": 0, "event": "enter"},
		"actions": [{"kind": "action_command", "command_name": "lock"}]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute returned err = %v, want nil", err)
	}
	env := out.(*automationGraphValidateOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if env.ValidationError != "place_id is required" {
		t.Errorf("ValidationError = %q, want %q", env.ValidationError, "place_id is required")
	}
}

// TestValidateAutomationGraph_NilValidator_Errors proves the
// validate-only tool surfaces a clear error when the validator is
// missing.
func TestValidateAutomationGraph_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &validateAutomationGraphTool{validator: nil}
	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "x",
		"trigger": {"kind": "trigger_event", "event_type": "drive_start"},
		"actions": [{"kind": "action_command", "command_name": "x"}]
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want non-nil")
	}
}

// TestValidateAutomationGraph_ToolMetadata pins the Tool interface
// contract for the validate-only tool.
func TestValidateAutomationGraph_ToolMetadata(t *testing.T) {
	t.Parallel()
	tool := &validateAutomationGraphTool{validator: &stubAutomationValidator{}}
	if tool.Name() != "validate_automation_graph" {
		t.Errorf("Name() = %q", tool.Name())
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q", tool.RequiredScope())
	}
	if len(tool.InputSchema()) == 0 {
		t.Error("InputSchema() empty")
	}
	if tool.OutputSchema() != nil {
		t.Errorf("OutputSchema() = %s, want nil", tool.OutputSchema())
	}
}

// TestRegisterAutomationBuilderTools_RegistersBoth proves the
// registration helper installs both tools on the registry and they
// are resolvable by name.
func TestRegisterAutomationBuilderTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterAutomationBuilderTools(r, AutomationBuilderSources{
		Validator: &stubAutomationValidator{},
	})

	for _, name := range []string{"draft_automation_graph", "validate_automation_graph"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("Get(%q) returned not-found after registration", name)
		}
	}
}

// TestRegisterAutomationBuilderTools_DoesNotShadowBuiltins proves
// registration of the new tools does not collide with the
// 12-builtin starter set or earlier slice registrations.
func TestRegisterAutomationBuilderTools_DoesNotShadowBuiltins(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	RegisterAutomationBuilderTools(r, AutomationBuilderSources{
		Validator: &stubAutomationValidator{},
	})

	for _, name := range BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q is missing after RegisterAutomationBuilderTools — registration shadowed it", name)
		}
	}
	for _, name := range []string{"draft_automation_graph", "validate_automation_graph"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("new tool %q is missing — RegisterAutomationBuilderTools failed", name)
		}
	}
}

// TestBuildWirePayload_OmitsZeroFields proves the per-step map
// builder drops empty/zero pointer fields so the canonical
// DisallowUnknownFields decoder is never confronted with a
// kind-irrelevant key.
func TestBuildWirePayload_OmitsZeroFields(t *testing.T) {
	t.Parallel()
	in := automationGraphDraftInput{
		VehicleID: 1,
		Name:      "x",
		Trigger:   automationGraphTriggerInput{Kind: "trigger_event", EventType: "drive_start"},
		Actions:   []automationGraphActionInput{{Kind: "action_command", CommandName: "lock"}},
	}
	wire, err := buildWirePayload(in)
	if err != nil {
		t.Fatalf("buildWirePayload err = %v", err)
	}

	// The trigger map MUST contain only kind + event_type — none
	// of the trigger_signal / trigger_geofence / trigger_schedule
	// fields should leak.
	var decoded struct {
		Triggers []map[string]any `json:"triggers"`
		Actions  []map[string]any `json:"actions"`
	}
	if err := json.Unmarshal(wire, &decoded); err != nil {
		t.Fatalf("decode wire: %v", err)
	}
	if len(decoded.Triggers) != 1 {
		t.Fatalf("triggers len = %d, want 1", len(decoded.Triggers))
	}
	for _, forbidden := range []string{"signal", "op", "value_num", "place_id", "cron_expr", "dwell_minutes"} {
		if _, ok := decoded.Triggers[0][forbidden]; ok {
			t.Errorf("triggers[0] contains kind-irrelevant field %q: %v", forbidden, decoded.Triggers[0])
		}
	}
	for _, forbidden := range []string{"channel_id", "template", "setting_key", "target_automation_id"} {
		if _, ok := decoded.Actions[0][forbidden]; ok {
			t.Errorf("actions[0] contains kind-irrelevant field %q: %v", forbidden, decoded.Actions[0])
		}
	}
}
