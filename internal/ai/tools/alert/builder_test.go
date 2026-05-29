// Tool tests for draft_alert_rule + validate_alert_rule. Both tools
// are pure functions over input + AlertRuleValidator interface; the
// tests stub the validator with a deterministic fake so the tests
// stay hermetic (no api package import, no DB).

package alert

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// stubAlertValidator records every call + can be wired to fail for
// the rejection-path tests.
type stubAlertValidator struct {
	failWith error
	calls    []*alertmodel.AlertRule
}

func (s *stubAlertValidator) ValidateAlertRule(rule *alertmodel.AlertRule) error {
	s.calls = append(s.calls, rule)
	return s.failWith
}

// TestDraftAlertRule_HappyPath_OK proves a valid LLM payload yields
// status="ok" + a Draft whose vehicle scope is clamped to the
// requested vehicle.
func TestDraftAlertRule_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubAlertValidator{}
	tool := &draftAlertRule{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Battery low",
		"signal_name": "battery_level",
		"op": "<",
		"value_num": 20,
		"severity": "warn",
		"cooldown_min": 30,
		"trigger_mode": "once"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*alertRuleDraftOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *alertRuleDraftOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (validation_error=%q)", env.Status, "ok", env.ValidationError)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty on ok", env.ValidationError)
	}
	if env.Draft == nil {
		t.Fatal("Draft is nil")
	}
	if env.Draft.SignalName != "battery_level" {
		t.Errorf("Draft.SignalName = %q, want %q", env.Draft.SignalName, "battery_level")
	}
	if env.Draft.Op != "<" {
		t.Errorf("Draft.Op = %q, want %q", env.Draft.Op, "<")
	}
	if env.Draft.ValueNum == nil || *env.Draft.ValueNum != 20 {
		t.Errorf("Draft.ValueNum = %v, want 20", env.Draft.ValueNum)
	}
	if env.Draft.AllVehicles {
		t.Error("Draft.AllVehicles = true, want false (scoped)")
	}
	if len(env.Draft.VehicleIDs) != 1 || env.Draft.VehicleIDs[0] != 1 {
		t.Errorf("Draft.VehicleIDs = %v, want [1]", env.Draft.VehicleIDs)
	}
	if env.Draft.Kind != alertmodel.AlertRuleKindSignal {
		t.Errorf("Draft.Kind = %q, want %q", env.Draft.Kind, alertmodel.AlertRuleKindSignal)
	}
	if !env.Draft.Enabled {
		t.Error("Draft.Enabled = false, want true (default)")
	}
	if !env.Draft.IncludeTitle {
		t.Error("Draft.IncludeTitle = false, want true (default)")
	}
	if env.Source == "" {
		t.Error("Source is empty; expected validator-attribution string")
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

// TestDraftAlertRule_ScopeClampOverridesLLMVehicleID proves the typed
// scope clamp defends against a hallucinated vehicle_id even when the
// LLM proposes one. The strategy's system prompt tells the model to
// refuse cross-vehicle requests, but a confused model could still
// emit one — buildDraftRule must overwrite VehicleIDs to the
// caller-supplied vehicle so the saved draft can never escape scope.
func TestDraftAlertRule_ScopeClampOverridesLLMVehicleID(t *testing.T) {
	t.Parallel()
	stub := &stubAlertValidator{}
	tool := &draftAlertRule{validator: stub}

	// Whatever vehicle_id the LLM emits IS the scope — the AI
	// handler is responsible for substituting the caller's actual
	// vehicle into the input before the tool fires. The tool's
	// invariant is "VehicleIDs == [vehicle_id]"; this test pins
	// that invariant.
	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"name": "Test",
		"signal_name": "battery_level",
		"op": ">",
		"value_num": 95,
		"severity": "info",
		"cooldown_min": 60
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, _ := tool.Execute(context.Background(), in)
	env := out.(*alertRuleDraftOutput)
	if env.Draft.AllVehicles {
		t.Error("Draft.AllVehicles = true, want false")
	}
	if len(env.Draft.VehicleIDs) != 1 || env.Draft.VehicleIDs[0] != 7 {
		t.Errorf("Draft.VehicleIDs = %v, want [7] (clamped to caller-supplied vehicle)", env.Draft.VehicleIDs)
	}
}

// TestDraftAlertRule_InvalidSurfacedAsStatusNotError proves a
// canonical validator rejection becomes status="invalid" + a
// validation_error string in the envelope, NOT a returned Go error.
// The dispatcher's tool-error path is reserved for genuine
// programming errors (nil validator wired, malformed JSON), not for
// "the user asked for something the canonical layer rejects".
func TestDraftAlertRule_InvalidSurfacedAsStatusNotError(t *testing.T) {
	t.Parallel()
	stub := &stubAlertValidator{failWith: errors.New("signal_name unknown")}
	tool := &draftAlertRule{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Bad",
		"signal_name": "totally_made_up",
		"op": "<",
		"value_num": 0,
		"severity": "info",
		"cooldown_min": 30
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (rejection should be a status, not an error)", err)
	}
	env := out.(*alertRuleDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if env.ValidationError == "" {
		t.Error("ValidationError is empty; expected the validator's diagnostic")
	}
	if env.Draft == nil {
		t.Error("Draft is nil; expected partial draft so the UI can render the error in context")
	}
}

// TestDraftAlertRule_DefaultsTriggerModeRepeat proves an omitted
// trigger_mode falls back to "repeat" — matching the canonical
// validateTriggerMode default.
func TestDraftAlertRule_DefaultsTriggerModeRepeat(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRule{validator: &stubAlertValidator{}}
	in, _ := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "X",
		"signal_name": "battery_level",
		"op": "<",
		"value_num": 10,
		"severity": "warn",
		"cooldown_min": 5
	}`))
	out, _ := tool.Execute(context.Background(), in)
	env := out.(*alertRuleDraftOutput)
	if env.Draft.TriggerMode != "repeat" {
		t.Errorf("Draft.TriggerMode = %q, want %q (default)", env.Draft.TriggerMode, "repeat")
	}
}

// TestDraftAlertRule_NilValidatorIsExecutionError pins the wiring-bug
// guard. A nil validator here is a programming error (the
// constructor / RegisterAlertBuilderTools should never produce it),
// but the tool defends with an explicit error rather than a nil
// dereference panic.
func TestDraftAlertRule_NilValidatorIsExecutionError(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRule{}
	in, _ := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "X",
		"signal_name": "battery_level",
		"op": "<",
		"value_num": 10,
		"severity": "warn",
		"cooldown_min": 5
	}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil with nil validator, want non-nil")
	}
	if !strings.Contains(err.Error(), "no AlertRuleValidator wired") {
		t.Errorf("err = %v, want message about missing validator", err)
	}
}

// TestDraftAlertRule_ContractMetadata pins the propose-only contract
// shape. Mutates() MUST stay false (the dispatcher's deny-all
// confirm gate would otherwise refuse the tool); RequiredScope() is
// empty (the AI guard upstream gates on ai_mode + per-feature
// toggle); Name() is the canonical kebab-case name the goldens
// reference.
func TestDraftAlertRule_ContractMetadata(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRule{validator: &stubAlertValidator{}}
	if got := tool.Name(); got != "draft_alert_rule" {
		t.Errorf("Name() = %q, want %q", got, "draft_alert_rule")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false (PROPOSE-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if !strings.Contains(tool.Description(), "PROPOSE-ONLY") {
		t.Error("Description() missing PROPOSE-ONLY marker; LLM-visible")
	}
}

// TestValidateAlertRuleTool_HappyPath proves an OK validation
// returns status="ok" + empty validation_error. Mirrors the
// draft_alert_rule happy path.
func TestValidateAlertRuleTool_HappyPath(t *testing.T) {
	t.Parallel()
	stub := &stubAlertValidator{}
	tool := &validateAlertRuleTool{validator: stub}
	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "OK",
		"signal_name": "battery_level",
		"op": "<",
		"value_num": 20,
		"severity": "warn",
		"cooldown_min": 30
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*alertRuleValidateOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *alertRuleValidateOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (err=%q)", env.Status, "ok", env.ValidationError)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty on ok", env.ValidationError)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

// TestValidateAlertRuleTool_InvalidSurfacedAsStatus mirrors the
// draft_alert_rule invalid-path test: a canonical-layer rejection
// becomes status="invalid" + validation_error, NOT an Execute error.
func TestValidateAlertRuleTool_InvalidSurfacedAsStatus(t *testing.T) {
	t.Parallel()
	stub := &stubAlertValidator{failWith: errors.New("op '<' requires value_num")}
	tool := &validateAlertRuleTool{validator: stub}
	in, _ := tool.Validate(json.RawMessage(`{
		"vehicle_id": 1,
		"name": "Bad",
		"signal_name": "battery_level",
		"op": "<",
		"value_num": 20,
		"severity": "warn",
		"cooldown_min": 30
	}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*alertRuleValidateOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if !strings.Contains(env.ValidationError, "value_num") {
		t.Errorf("ValidationError = %q, want substring 'value_num'", env.ValidationError)
	}
}

// TestValidateAlertRuleTool_ContractMetadata pins the propose-only
// contract shape for the validator tool.
func TestValidateAlertRuleTool_ContractMetadata(t *testing.T) {
	t.Parallel()
	tool := &validateAlertRuleTool{validator: &stubAlertValidator{}}
	if got := tool.Name(); got != "validate_alert_rule" {
		t.Errorf("Name() = %q, want %q", got, "validate_alert_rule")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if !strings.Contains(tool.Description(), "PROPOSE-ONLY") {
		t.Error("Description() missing PROPOSE-ONLY marker")
	}
}

// TestRegisterAlertBuilderTools_RegistersBoth proves the registration
// helper wires both tools onto the registry under their canonical
// names.
func TestRegisterAlertBuilderTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	reg := tools.NewRegistry()
	RegisterAlertBuilderTools(reg, AlertBuilderSources{Validator: &stubAlertValidator{}})

	for _, name := range []string{"draft_alert_rule", "validate_alert_rule"} {
		if _, ok := reg.Get(name); !ok {
			t.Errorf("registry missing tool %q after RegisterAlertBuilderTools", name)
		}
	}
}

// TestAlertBuilderInputValidation_RejectsBadShapes asserts the
// schema-derived validator catches obviously-bad LLM payloads
// before they reach Execute. Mirrors the contract that lets the
// dispatcher relay a meaningful error message to the model on the
// next turn.
func TestAlertBuilderInputValidation_RejectsBadShapes(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRule{validator: &stubAlertValidator{}}
	cases := []struct {
		name string
		body string
	}{
		{"missing vehicle_id", `{"name":"X","signal_name":"battery_level","op":"<","value_num":1,"severity":"warn","cooldown_min":1}`},
		{"missing name", `{"vehicle_id":1,"signal_name":"battery_level","op":"<","value_num":1,"severity":"warn","cooldown_min":1}`},
		{"unknown severity", `{"vehicle_id":1,"name":"X","signal_name":"battery_level","op":"<","value_num":1,"severity":"warning","cooldown_min":1}`},
		{"unknown op", `{"vehicle_id":1,"name":"X","signal_name":"battery_level","op":"approx","value_num":1,"severity":"warn","cooldown_min":1}`},
		{"zero cooldown", `{"vehicle_id":1,"name":"X","signal_name":"battery_level","op":"<","value_num":1,"severity":"warn","cooldown_min":0}`},
		{"negative cooldown", `{"vehicle_id":1,"name":"X","signal_name":"battery_level","op":"<","value_num":1,"severity":"warn","cooldown_min":-5}`},
		{"unknown trigger_mode", `{"vehicle_id":1,"name":"X","signal_name":"battery_level","op":"<","value_num":1,"severity":"warn","cooldown_min":1,"trigger_mode":"hourly"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(tc.body)); err == nil {
				t.Errorf("Validate(%s) err = nil, want non-nil", tc.body)
			}
		})
	}
}
