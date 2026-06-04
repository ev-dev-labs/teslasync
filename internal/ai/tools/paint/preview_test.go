// Tool tests for draft_paint_preview_prompt. The tool is a pure
// function over input + VehicleSource so the tests stay hermetic
// (no api or database package, no DB).

package paint

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/toolstest"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// newPaintPreviewTestVehicle builds a deterministic *vehiclemodel.Vehicle
// for id=7 used by the happy-path tests.
func newPaintPreviewTestVehicle() *vehiclemodel.Vehicle {
	model := "Model Y"
	trim := "Long Range AWD"
	color := "Pearl White"
	return &vehiclemodel.Vehicle{
		ID:          7,
		TeslaID:     7001,
		VIN:         "5YJ3E1EA0NF000007",
		DisplayName: "My Model Y",
		Model:       &model,
		TrimLevel:   &trim,
		Color:       &color,
		Timezone:    "America/Los_Angeles",
	}
}

// TestDraftPaintPreviewPrompt_HappyPath proves a valid LLM payload
// yields status="ok" with a suggestion seed + evidence grounded in
// the vehicle's actual model / trim / current color.
func TestDraftPaintPreviewPrompt_HappyPath(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: newPaintPreviewTestVehicle()}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "Midnight Blue", "style_hint": "studio"}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env, ok := out.(*paintPreviewDraftOutput)
	if !ok {
		t.Fatalf("output type = %T, want *paintPreviewDraftOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (validation_error=%q)", env.Status, env.ValidationError)
	}
	if env.Suggested == nil {
		t.Fatal("Suggested envelope is nil")
	}
	if env.Suggested.VehicleID != 7 {
		t.Errorf("Suggested.VehicleID = %d, want 7", env.Suggested.VehicleID)
	}
	if env.Suggested.ProposedColor != "Midnight Blue" {
		t.Errorf("Suggested.ProposedColor = %q, want Midnight Blue", env.Suggested.ProposedColor)
	}
	if env.Suggested.StyleHint != "studio" {
		t.Errorf("Suggested.StyleHint = %q, want studio", env.Suggested.StyleHint)
	}
	if !strings.Contains(env.Suggested.ImagePrompt, "Midnight Blue") {
		t.Errorf("Suggested.ImagePrompt missing proposed color: %q", env.Suggested.ImagePrompt)
	}
	if !strings.Contains(env.Suggested.ImagePrompt, "Model Y") {
		t.Errorf("Suggested.ImagePrompt missing model: %q", env.Suggested.ImagePrompt)
	}
	if env.Evidence.Model == nil || *env.Evidence.Model != "Model Y" {
		t.Errorf("Evidence.Model = %v, want Model Y", env.Evidence.Model)
	}
	if env.Evidence.TrimLevel == nil || *env.Evidence.TrimLevel != "Long Range AWD" {
		t.Errorf("Evidence.TrimLevel = %v, want Long Range AWD", env.Evidence.TrimLevel)
	}
	if env.Evidence.CurrentColor == nil || *env.Evidence.CurrentColor != "Pearl White" {
		t.Errorf("Evidence.CurrentColor = %v, want Pearl White", env.Evidence.CurrentColor)
	}
}

// TestDraftPaintPreviewPrompt_OmitsDisplayName proves the typed
// evidence + suggestion envelope NEVER expose the vehicle's
// display_name or VIN — defence-in-depth against the redaction
// policy failing for any reason.
func TestDraftPaintPreviewPrompt_OmitsDisplayName(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: newPaintPreviewTestVehicle()}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "Arctic Silver"}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	for _, forbidden := range []string{"My Model Y", "display_name", "5YJ3E1EA0NF000007", "vin"} {
		if strings.Contains(string(raw), forbidden) {
			t.Errorf("paint-preview envelope leaks %q: %s", forbidden, string(raw))
		}
	}
}

// TestDraftPaintPreviewPrompt_NoStyleHint proves the deterministic
// seed falls back to a sensible default style when the LLM omits the
// style_hint argument.
func TestDraftPaintPreviewPrompt_NoStyleHint(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: newPaintPreviewTestVehicle()}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "Solid Black"}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*paintPreviewDraftOutput)
	if env.Suggested.StyleHint != "studio" {
		t.Errorf("Suggested.StyleHint fallback = %q, want studio", env.Suggested.StyleHint)
	}
}

// TestDraftPaintPreviewPrompt_VehicleNotFound proves a missing
// vehicle surfaces as a returned error (so the LLM can retry with
// the correct vehicle_id) rather than a silent envelope.
func TestDraftPaintPreviewPrompt_VehicleNotFound(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 999, "proposed_color": "Red"}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute: want error for missing vehicle, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Execute err = %v, want 'not found'", err)
	}
}

// TestDraftPaintPreviewPrompt_SourceError proves a repository error
// is propagated to the dispatcher (not silently swallowed).
func TestDraftPaintPreviewPrompt_SourceError(t *testing.T) {
	t.Parallel()
	src := &toolstest.FakeVehicles{Err: errors.New("db down")}
	tool := &draftPaintPreviewPrompt{vehicles: src}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "Red"}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil || !strings.Contains(err.Error(), "db down") {
		t.Fatalf("Execute err = %v, want db down", err)
	}
}

// TestDraftPaintPreviewPrompt_RejectsControlChars proves the
// validator refuses control characters in the proposed color.
func TestDraftPaintPreviewPrompt_RejectsControlChars(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: newPaintPreviewTestVehicle()}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "Red\u0007Blue"}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*paintPreviewDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "control characters") {
		t.Errorf("ValidationError = %q, want 'control characters'", env.ValidationError)
	}
}

// TestDraftPaintPreviewPrompt_RejectsLatLong proves the validator
// refuses precise lat/long coordinates in the proposed color
// (defence-in-depth against the LLM smuggling location through the
// color field).
func TestDraftPaintPreviewPrompt_RejectsLatLong(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: newPaintPreviewTestVehicle()}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "37.7749, -122.4194 Blue"}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*paintPreviewDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "lat/long") {
		t.Errorf("ValidationError = %q, want 'lat/long'", env.ValidationError)
	}
}

// TestDraftPaintPreviewPrompt_RejectsStreetAddress proves the
// validator refuses obvious "<number> <Word> <Street-type>"
// patterns in the style hint.
func TestDraftPaintPreviewPrompt_RejectsStreetAddress(t *testing.T) {
	t.Parallel()
	vehicles := &toolstest.FakeVehicles{One: map[int64]*vehiclemodel.Vehicle{7: newPaintPreviewTestVehicle()}}
	tool := &draftPaintPreviewPrompt{vehicles: vehicles}

	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 7, "proposed_color": "Red", "style_hint": "123 Main St"}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*paintPreviewDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "street addresses") {
		t.Errorf("ValidationError = %q, want 'street addresses'", env.ValidationError)
	}
}

// TestDraftPaintPreviewPrompt_NeverMutates proves Mutates() is
// false. The dispatcher's confirm gate must NEVER fire for this
// tool.
func TestDraftPaintPreviewPrompt_NeverMutates(t *testing.T) {
	t.Parallel()
	tool := &draftPaintPreviewPrompt{vehicles: &toolstest.FakeVehicles{}}
	if tool.Mutates() {
		t.Fatal("Mutates() = true; vehicle-paint-preview must be propose-only")
	}
}

// TestDraftPaintPreviewPrompt_Name pins the tool's wire name
// (referenced by the strategy's allowedTools whitelist, the
// goldens.yaml, and aivet's coverage tests).
func TestDraftPaintPreviewPrompt_Name(t *testing.T) {
	t.Parallel()
	tool := &draftPaintPreviewPrompt{vehicles: &toolstest.FakeVehicles{}}
	if got := tool.Name(); got != "draft_paint_preview_prompt" {
		t.Fatalf("Name() = %q, want draft_paint_preview_prompt", got)
	}
}

// TestRegisterVehiclePaintPreviewTools_RegistersTool proves the
// register helper installs the tool on the registry and that a
// second call panics (duplicate-registration guard).
func TestRegisterVehiclePaintPreviewTools_RegistersTool(t *testing.T) {
	t.Parallel()
	reg := tools.NewRegistry()
	vehicles := &toolstest.FakeVehicles{}

	RegisterVehiclePaintPreviewTools(reg, VehiclePaintPreviewSources{Vehicles: vehicles})

	if _, ok := reg.Get("draft_paint_preview_prompt"); !ok {
		t.Fatal("draft_paint_preview_prompt not registered")
	}

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate registration")
		}
	}()
	RegisterVehiclePaintPreviewTools(reg, VehiclePaintPreviewSources{Vehicles: vehicles})
}
