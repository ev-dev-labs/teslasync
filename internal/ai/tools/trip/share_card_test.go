// Phase-50 / 0060 — GEN1 Trip postcard and share-card image generation.
//
// Tool tests for draft_image_prompt + render_share_card_preview.
// Both tools are pure functions over input + TripDetailSource so
// the tests stay hermetic (no api or database package, no DB).

package trip

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
)

// newShareCardTestDetail builds a deterministic *tripdb.TripDetail
// for id=101 used by the happy-path tests.
func newShareCardTestDetail() *tripdb.TripDetail {
	startedAt := time.Date(2024, 10, 12, 8, 30, 0, 0, time.UTC)
	endedAt := time.Date(2024, 10, 13, 18, 45, 0, 0, time.UTC)
	startPlace := "Seattle, WA"
	endPlace := "Portland, OR"
	currentName := "Weekend Road Trip"
	return &tripdb.TripDetail{
		ID:           101,
		VehicleID:    7,
		Name:         &currentName,
		StartedAt:    startedAt,
		EndedAt:      &endedAt,
		DistanceM:    287_500,
		EnergyUsedWh: 64_800,
		DurationS:    18_900,
		DriveCount:   2,
		ChargeCount:  1,
		TotalCost:    14.32,
		Drives: []tripdb.TripDriveSummary{
			{ID: 5001, StartedAt: startedAt, StartPlace: &startPlace, EndPlace: ptrString("Olympia, WA")},
			{ID: 5002, StartedAt: startedAt.Add(2 * time.Hour), StartPlace: ptrString("Olympia, WA"), EndPlace: &endPlace},
		},
	}
}

// TestDraftImagePrompt_HappyPath proves a valid LLM payload yields
// status="ok" with a suggestion seed + evidence grounded in the
// trip's actual route context.
func TestDraftImagePrompt_HappyPath(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &draftImagePrompt{details: details}

	in, err := tool.Validate(json.RawMessage(`{"trip_id": 101, "style_hint": "vintage"}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env, ok := out.(*shareCardImageDraftOutput)
	if !ok {
		t.Fatalf("output type = %T, want *shareCardImageDraftOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.Suggested == nil {
		t.Fatal("Suggested envelope is nil")
	}
	if env.Suggested.TripID != 101 || env.Suggested.VehicleID != 7 {
		t.Errorf("Suggested ID pair = (%d, %d), want (101, 7)", env.Suggested.TripID, env.Suggested.VehicleID)
	}
	if env.Suggested.StyleHint != "vintage" {
		t.Errorf("Suggested.StyleHint = %q, want vintage", env.Suggested.StyleHint)
	}
	if !strings.Contains(env.Suggested.ImagePrompt, "vintage") {
		t.Errorf("Suggested.ImagePrompt missing style hint: %q", env.Suggested.ImagePrompt)
	}
	if env.Evidence.StartPlace == nil || *env.Evidence.StartPlace != "Seattle, WA" {
		t.Errorf("Evidence.StartPlace = %v, want Seattle, WA", env.Evidence.StartPlace)
	}
	if env.Evidence.EndPlace == nil || *env.Evidence.EndPlace != "Portland, OR" {
		t.Errorf("Evidence.EndPlace = %v, want Portland, OR", env.Evidence.EndPlace)
	}
	if env.Evidence.DriveCount != 2 {
		t.Errorf("Evidence.DriveCount = %d, want 2", env.Evidence.DriveCount)
	}
	if env.Evidence.DistanceM != 287_500 {
		t.Errorf("Evidence.DistanceM = %f, want 287500", env.Evidence.DistanceM)
	}
	if env.Evidence.EnergyWh != 64_800 {
		t.Errorf("Evidence.EnergyWh = %f, want 64800", env.Evidence.EnergyWh)
	}
}

// TestDraftImagePrompt_NoStyleHint proves the deterministic seed
// falls back to a sensible default style when the LLM omits the
// style_hint argument.
func TestDraftImagePrompt_NoStyleHint(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &draftImagePrompt{details: details}

	in, err := tool.Validate(json.RawMessage(`{"trip_id": 101}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*shareCardImageDraftOutput)
	if env.Suggested.StyleHint != "illustrated postcard" {
		t.Errorf("Suggested.StyleHint fallback = %q, want illustrated postcard", env.Suggested.StyleHint)
	}
}

// TestDraftImagePrompt_TripNotFound proves a missing trip surfaces
// as a returned error (the LLM retries).
func TestDraftImagePrompt_TripNotFound(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{}}
	tool := &draftImagePrompt{details: details}

	in, _ := tool.Validate(json.RawMessage(`{"trip_id": 9999}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute err = nil, want trip-not-found")
	}
}

// TestDraftImagePrompt_RejectsInvalidInput proves the typed
// validator rejects malformed input before any Execute work runs.
func TestDraftImagePrompt_RejectsInvalidInput(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &draftImagePrompt{details: details}

	cases := []struct {
		name string
		raw  string
	}{
		{"missing trip_id", `{}`},
		{"trip_id 0", `{"trip_id": 0}`},
		{"style_hint too long", `{"trip_id": 101, "style_hint": "` + strings.Repeat("X", 81) + `"}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := tool.Validate(json.RawMessage(tc.raw)); err == nil {
				t.Fatalf("Validate(%q) err = nil, want error", tc.raw)
			}
		})
	}
}

// TestRenderShareCardPreview_HappyPath proves a valid LLM payload
// yields status="ok" with a populated Preview envelope.
func TestRenderShareCardPreview_HappyPath(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &renderShareCardPreview{details: details}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_title": "Weekend Road Trip — October 2024",
		"image_prompt": "A vintage postcard illustration of an electric vehicle on a coastal highway at sunset.",
		"style_hint": "vintage"
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env, ok := out.(*shareCardImagePreviewOutput)
	if !ok {
		t.Fatalf("output type = %T", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok; ValidationError=%q", env.Status, env.ValidationError)
	}
	if env.Preview == nil {
		t.Fatal("Preview is nil on Status=ok")
	}
	if env.Preview.ProposedTitle != "Weekend Road Trip — October 2024" {
		t.Errorf("Preview.ProposedTitle = %q", env.Preview.ProposedTitle)
	}
	if env.Preview.StyleHint != "vintage" {
		t.Errorf("Preview.StyleHint = %q", env.Preview.StyleHint)
	}
}

// TestRenderShareCardPreview_RejectsLatLong proves the validator
// refuses cleartext lat/long coordinates in the proposed title or
// image prompt (defence-in-depth even though the redaction policy
// strips them upstream).
func TestRenderShareCardPreview_RejectsLatLong(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &renderShareCardPreview{details: details}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_title": "Trip from 37.7749, -122.4194 to elsewhere",
		"image_prompt": "A vintage postcard scene."
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*shareCardImagePreviewOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid for lat/long leak", env.Status)
	}
	if !strings.Contains(env.ValidationError, "lat/long") {
		t.Errorf("ValidationError missing 'lat/long': %q", env.ValidationError)
	}
}

// TestRenderShareCardPreview_RejectsStreetAddr proves the validator
// refuses obvious street-address-shaped strings.
func TestRenderShareCardPreview_RejectsStreetAddr(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &renderShareCardPreview{details: details}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_title": "Trip starting at 123 Main Street",
		"image_prompt": "A vintage postcard scene."
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	env := out.(*shareCardImagePreviewOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid for street-addr leak", env.Status)
	}
	if !strings.Contains(env.ValidationError, "street") {
		t.Errorf("ValidationError missing 'street': %q", env.ValidationError)
	}
}

// TestRenderShareCardPreview_RejectsControlChars proves the
// validator refuses control characters anywhere in the proposed
// title or image prompt.
func TestRenderShareCardPreview_RejectsControlChars(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &renderShareCardPreview{details: details}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_title": "Weekend\tRoad Trip",
		"image_prompt": "A vintage postcard scene."
	}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	out, _ := tool.Execute(context.Background(), in)
	env := out.(*shareCardImagePreviewOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid for control char", env.Status)
	}
}

// TestRenderShareCardPreview_RejectsLongTitle proves the validator
// caps the title at 100 chars (mirrors the slice prompt's narrative
// cap).
func TestRenderShareCardPreview_RejectsLongTitle(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{101: newShareCardTestDetail()}}
	tool := &renderShareCardPreview{details: details}

	tooLong := strings.Repeat("X", 101)
	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_title": "` + tooLong + `",
		"image_prompt": "A scene."
	}`))
	if err != nil {
		// JSON-schema-tier rejection is acceptable — proves the
		// cap is enforced one way or the other.
		return
	}
	out, _ := tool.Execute(context.Background(), in)
	env := out.(*shareCardImagePreviewOutput)
	if env.Status == "ok" {
		t.Error("Status = ok for 101-char title; want invalid")
	}
}

// TestRenderShareCardPreview_TripNotFound proves a missing trip
// surfaces as a returned error.
func TestRenderShareCardPreview_TripNotFound(t *testing.T) {
	t.Parallel()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{}}
	tool := &renderShareCardPreview{details: details}

	in, _ := tool.Validate(json.RawMessage(`{
		"trip_id": 9999,
		"proposed_title": "Trip",
		"image_prompt": "A scene."
	}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute err = nil, want trip-not-found")
	}
}

// TestRegisterTripPostcardShareCardImageGenerationTools_RegistersBoth
// proves the register function installs both tools on the registry
// and they are addressable by canonical name.
func TestRegisterTripPostcardShareCardImageGenerationTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	details := &stubTripDetailSource{byID: map[int64]*tripdb.TripDetail{}}
	RegisterTripPostcardShareCardImageGenerationTools(r, TripPostcardShareCardImageGenerationSources{Details: details})

	for _, name := range []string{"draft_image_prompt", "render_share_card_preview"} {
		if tool, ok := r.Get(name); !ok || tool == nil {
			t.Errorf("Registry.Get(%q) missing after registration", name)
		}
	}
}

// TestShareCardTools_AreNotMutating proves Mutates() returns false
// for both tools (propose-only contract).
func TestShareCardTools_AreNotMutating(t *testing.T) {
	t.Parallel()
	if (&draftImagePrompt{}).Mutates() {
		t.Error("draft_image_prompt.Mutates() = true, want false")
	}
	if (&renderShareCardPreview{}).Mutates() {
		t.Error("render_share_card_preview.Mutates() = true, want false")
	}
}

// TestValidateShareCardImageString covers the per-field rules
// directly so the validator's behaviour is pinned without going
// through the tool wrapper.
func TestValidateShareCardImageString(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		value   string
		maxLen  int
		wantErr bool
	}{
		{"empty", "", 100, true},
		{"whitespace only", "   ", 100, true},
		{"leading whitespace", " hello", 100, true},
		{"trailing whitespace", "hello ", 100, true},
		{"control char", "hello\nworld", 100, true},
		{"over cap", strings.Repeat("X", 101), 100, true},
		{"lat/long leak", "Trip 37.7749, -122.4194 to anywhere", 100, true},
		{"street-addr leak", "Trip from 123 Main Street to anywhere", 100, true},
		{"valid simple", "October Road Trip", 100, false},
		{"valid with emoji", "🚗 October Road Trip", 100, false},
		{"valid generic city pair", "From Seattle to Portland", 100, false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := validateShareCardImageString("title", tc.value, tc.maxLen)
			if tc.wantErr && err == nil {
				t.Errorf("validateShareCardImageString(%q) err = nil, want non-nil", tc.value)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("validateShareCardImageString(%q) err = %v, want nil", tc.value, err)
			}
		})
	}
}
