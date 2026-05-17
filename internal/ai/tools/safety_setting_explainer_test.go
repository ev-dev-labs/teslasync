// Phase-50 / 0054 — P3 Helix safety setting explainer.
//
// Unit tests for the query_safety_settings tool. The tool wraps
// a SafetySettingsSource port (production adapter wraps the
// canonical SettingsRepo); the test substitutes a hermetic fake
// so the tool unit tests stay free of database IO.
//
// The tool has no per-request scope binding (settings are
// global) so the test surface is small: pin the read-only
// contract, the empty-input shape, the missing-source refusal,
// the nil-envelope refusal, the nil-map defensive promotion,
// and the happy-path delegation.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Fake source
// ---------------------------------------------------------------------------

// fakeSafetySettingsSource is a hermetic stand-in for the
// production adapter (*api.AISafetySettingExplainerSource). The
// per-test cases install canned responses; the tool never sees
// a database.
type fakeSafetySettingsSource struct {
	loadFn func(ctx context.Context) (*SafetySettingsEnvelope, error)
}

func (f *fakeSafetySettingsSource) LoadSafetySettings(ctx context.Context) (*SafetySettingsEnvelope, error) {
	if f.loadFn == nil {
		return &SafetySettingsEnvelope{
			Settings: map[string]SafetySettingDescriptor{
				"quiet_hours_enabled": {
					Key:              "quiet_hours_enabled",
					CurrentValue:     false,
					DefaultValue:     false,
					ShortDescription: "Toggles per-window non-critical notification suppression.",
					DocsAnchor:       "notifications/quiet-hours.md",
				},
			},
			Source: "fake",
		}, nil
	}
	return f.loadFn(ctx)
}

// ---------------------------------------------------------------------------
// query_safety_settings
// ---------------------------------------------------------------------------

func TestQuerySafetySettings_Name(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{}
	if got := tool.Name(); got != "query_safety_settings" {
		t.Errorf("Name() = %q, want query_safety_settings", got)
	}
}

func TestQuerySafetySettings_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

func TestQuerySafetySettings_Description(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{}
	desc := tool.Description()
	for _, must := range []string{
		"safety-related",
		"current_value",
		"default_value",
		"docs_anchor",
		"READ-only",
		"NO database write",
		// Honest "no PII crosses the boundary" disclosure.
		"NO PII",
		"scalar setting values only",
		// Honest "refuse out-of-scope" disclosure mirrors the
		// strategy's system prompt directive.
		"refuse politely",
	} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q; got=%q", must, desc)
		}
	}
}

func TestQuerySafetySettings_InputSchemaIsEmpty(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	// Decode + re-marshal so the test is robust against the
	// schema generator's whitespace formatting.
	var got map[string]any
	if err := json.Unmarshal(schema, &got); err != nil {
		t.Fatalf("InputSchema() did not decode as JSON: %v", err)
	}
	// The empty-struct schema must declare type=object with
	// no required properties — the LLM is free to call with
	// `{}` (or omit arguments entirely, which the dispatcher
	// normalises to `{}`).
	if got["type"] != "object" {
		t.Errorf("InputSchema().type = %v, want object", got["type"])
	}
	if req, ok := got["required"].([]any); ok && len(req) > 0 {
		t.Errorf("InputSchema().required = %v, want empty (tool takes no arguments)", req)
	}
}

func TestQuerySafetySettings_ValidateAcceptsEmptyObject(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{}
	in, err := tool.Validate(json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("Validate({}) err = %v, want nil", err)
	}
	if _, ok := in.(querySafetySettingsInput); !ok {
		t.Fatalf("Validate({}) returned %T, want querySafetySettingsInput", in)
	}
}

func TestQuerySafetySettings_ExecuteRefusesMissingSource(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{} // source intentionally nil
	_, err := tool.Execute(context.Background(), querySafetySettingsInput{})
	if err == nil {
		t.Fatal("Execute with nil source = nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "no SafetySettingsSource wired") {
		t.Errorf("Execute err = %q, want substring 'no SafetySettingsSource wired'", err)
	}
}

func TestQuerySafetySettings_ExecuteSurfacesSourceError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("source-down")
	tool := &querySafetySettings{
		source: &fakeSafetySettingsSource{
			loadFn: func(ctx context.Context) (*SafetySettingsEnvelope, error) {
				return nil, wantErr
			},
		},
	}
	_, err := tool.Execute(context.Background(), querySafetySettingsInput{})
	if !errors.Is(err, wantErr) {
		t.Errorf("Execute err = %v, want wraps %v", err, wantErr)
	}
}

func TestQuerySafetySettings_ExecuteRefusesNilEnvelope(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{
		source: &fakeSafetySettingsSource{
			loadFn: func(ctx context.Context) (*SafetySettingsEnvelope, error) {
				return nil, nil
			},
		},
	}
	_, err := tool.Execute(context.Background(), querySafetySettingsInput{})
	if err == nil {
		t.Fatal("Execute with nil envelope = nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "nil envelope") {
		t.Errorf("Execute err = %q, want substring 'nil envelope'", err)
	}
}

func TestQuerySafetySettings_ExecutePromotesNilMap(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{
		source: &fakeSafetySettingsSource{
			loadFn: func(ctx context.Context) (*SafetySettingsEnvelope, error) {
				return &SafetySettingsEnvelope{
					Settings: nil, // adapter forgot to initialize
					Source:   "fake",
				}, nil
			},
		},
	}
	out, err := tool.Execute(context.Background(), querySafetySettingsInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*SafetySettingsEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *SafetySettingsEnvelope", out)
	}
	if env.Settings == nil {
		t.Fatal("Execute did not promote nil Settings to empty map (LLM could falsely claim any key absent)")
	}
}

func TestQuerySafetySettings_ExecuteHappyPathDelegates(t *testing.T) {
	t.Parallel()
	tool := &querySafetySettings{
		source: &fakeSafetySettingsSource{}, // default canned envelope
	}
	out, err := tool.Execute(context.Background(), querySafetySettingsInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*SafetySettingsEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *SafetySettingsEnvelope", out)
	}
	if env.Source == "" {
		t.Error("Execute returned envelope with empty Source breadcrumb")
	}
	desc, present := env.Settings["quiet_hours_enabled"]
	if !present {
		t.Fatal("Execute envelope missing quiet_hours_enabled descriptor")
	}
	if desc.Key != "quiet_hours_enabled" {
		t.Errorf("descriptor.Key = %q, want quiet_hours_enabled", desc.Key)
	}
	if desc.DocsAnchor == "" {
		t.Error("descriptor.DocsAnchor is empty (LLM has nothing to cite)")
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterSafetySettingExplainerTools_RegistersOneTool(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	src := &fakeSafetySettingsSource{}
	RegisterSafetySettingExplainerTools(r, SafetySettingExplainerSources{Source: src})
	want := "query_safety_settings"
	if _, ok := r.Get(want); !ok {
		t.Errorf("Registry missing %q after RegisterSafetySettingExplainerTools", want)
	}
}

func TestRegisterSafetySettingExplainerTools_PanicsOnDuplicate(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	src := &fakeSafetySettingsSource{}
	RegisterSafetySettingExplainerTools(r, SafetySettingExplainerSources{Source: src})
	defer func() {
		if recover() == nil {
			t.Error("RegisterSafetySettingExplainerTools second call did not panic")
		}
	}()
	RegisterSafetySettingExplainerTools(r, SafetySettingExplainerSources{Source: src})
}
