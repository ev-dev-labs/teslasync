package alert

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

func TestDraftAlertMessageTemplate_SignalDimensions(t *testing.T) {
	t.Parallel()
	tool := &draftAlertMessageTemplate{}
	in, err := tool.Validate(json.RawMessage(`{
		"kind": "signal",
		"signal_name": "BrakePedal",
		"op": "=",
		"severity": "info",
		"value_bool": true
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env, ok := out.(*alertMessageTemplateDraftOutput)
	if !ok {
		t.Fatalf("got %T", out)
	}
	if env.Status != "ok" {
		t.Fatalf("status=%q err=%q", env.Status, env.ValidationError)
	}
	if env.SignalName != "BrakePedal" {
		t.Errorf("signal_name=%q", env.SignalName)
	}
	keys := map[string]struct{}{}
	for _, p := range env.AllowedPlaceholders {
		keys[p.Key] = struct{}{}
	}
	for _, want := range []string{"VehicleName", "Value", "Threshold", "BrakePedal", "SignalName"} {
		if _, ok := keys[want]; !ok {
			t.Errorf("missing placeholder %q in %+v", want, env.AllowedPlaceholders)
		}
	}
	if len(env.RelatedPresets) == 0 {
		t.Error("expected related presets for a signal rule")
	}
}

func TestDraftAlertMessageTemplate_MissingSignalName(t *testing.T) {
	t.Parallel()
	tool := &draftAlertMessageTemplate{}
	in, err := tool.Validate(json.RawMessage(`{"kind":"signal","op":"="}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*alertMessageTemplateDraftOutput)
	if env.Status != "invalid" {
		t.Fatalf("status=%q want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "signal_name") {
		t.Errorf("validation_error=%q", env.ValidationError)
	}
}

func TestValidateAlertMessageTemplate_RejectsUnknownPlaceholder(t *testing.T) {
	t.Parallel()
	tool := &validateAlertMessageTemplate{}
	in, err := tool.Validate(json.RawMessage(`{
		"kind": "signal",
		"signal_name": "BrakePedal",
		"op": "=",
		"template": "{{VehicleName}} hit {{NotARealPlaceholder}}"
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*alertMessageTemplateValidateOutput)
	if env.Status != "invalid" {
		t.Fatalf("status=%q want invalid", env.Status)
	}
	if len(env.UnknownKeys) != 1 || env.UnknownKeys[0] != "NotARealPlaceholder" {
		t.Errorf("unknown_keys=%v", env.UnknownKeys)
	}
}

func TestValidateAlertMessageTemplate_AcceptsGroundedTemplate(t *testing.T) {
	t.Parallel()
	tool := &validateAlertMessageTemplate{}
	in, err := tool.Validate(json.RawMessage(`{
		"kind": "signal",
		"signal_name": "BrakePedal",
		"op": "=",
		"template": "{{VehicleName}}: brake pedal {{Value}}"
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*alertMessageTemplateValidateOutput)
	if env.Status != "ok" {
		t.Fatalf("status=%q err=%q", env.Status, env.ValidationError)
	}
	if env.Template != "{{VehicleName}}: brake pedal {{Value}}" {
		t.Errorf("template=%q", env.Template)
	}
}

func TestRegisterAlertMessageTemplateTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterAlertMessageTemplateTools(r)
	if _, ok := r.Get("draft_alert_message_template"); !ok {
		t.Fatal("draft tool missing")
	}
	if _, ok := r.Get("validate_alert_message_template"); !ok {
		t.Fatal("validate tool missing")
	}
}
