// Tool tests for draft_location_name and validate_location_name. Both
// tools are pure functions over input + LocationSource +
// LocationNameValidator interfaces; the tests stub both with
// deterministic fakes so the tests stay hermetic (no api or
// database package, no DB).

package location

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// stubLocationSource is a deterministic fake for LocationSource.
type stubLocationSource struct {
	byID map[int64]*geomodel.VisitedLocation
	err  error
}

func (s *stubLocationSource) LoadVisitedLocation(_ context.Context, locationID int64) (*geomodel.VisitedLocation, error) {
	if s.err != nil {
		return nil, s.err
	}
	if l, ok := s.byID[locationID]; ok {
		return l, nil
	}
	return nil, nil
}

// stubLocationNameValidator records every call + can be wired to
// fail for the rejection-path tests.
type stubLocationNameValidator struct {
	failWith error
	calls    []struct {
		Loc      *geomodel.VisitedLocation
		Proposed string
	}
}

func (s *stubLocationNameValidator) ValidateLocationName(loc *geomodel.VisitedLocation, proposed string) error {
	s.calls = append(s.calls, struct {
		Loc      *geomodel.VisitedLocation
		Proposed string
	}{loc, proposed})
	return s.failWith
}

// newTestLocationFixtures builds a deterministic visited-location
// for id=501 used by most of the happy-path tests. Mirrors the
// auto-trip-naming fixture style.
func newTestLocationFixtures() *stubLocationSource {
	createdAt := time.Date(2024, 7, 15, 9, 0, 0, 0, time.UTC)
	lastVisited := time.Date(2024, 10, 14, 18, 30, 0, 0, time.UTC)
	loc := &geomodel.VisitedLocation{
		ID:             501,
		VehicleID:      7,
		AddressName:    "47.6062, -122.3321", // coord-shaped → unnamed
		VisitCount:     12,
		TotalDurationS: 3 * 3600 * 12, // 12 visits × 3h
		LastVisited:    &lastVisited,
		CreatedAt:      createdAt,
	}
	return &stubLocationSource{byID: map[int64]*geomodel.VisitedLocation{501: loc}}
}

// TestDraftLocationName_HappyPath_OK proves a valid LLM payload
// yields status="ok" + a draft envelope grounded in the location's
// actual visit evidence (current address_name, visit_count,
// total_duration_s, last_visited_at).
func TestDraftLocationName_HappyPath_OK(t *testing.T) {
	t.Parallel()
	locations := newTestLocationFixtures()
	validator := &stubLocationNameValidator{}
	tool := &draftLocationName{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"location_id": 501,
		"proposed_name": "Pike Place Market"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*locationNameDraftOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *locationNameDraftOutput", out)
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
	if env.Draft.LocationID != 501 {
		t.Errorf("Draft.LocationID = %d, want 501", env.Draft.LocationID)
	}
	if env.Draft.VehicleID != 7 {
		t.Errorf("Draft.VehicleID = %d, want 7", env.Draft.VehicleID)
	}
	if env.Draft.ProposedName != "Pike Place Market" {
		t.Errorf("Draft.ProposedName = %q, want %q", env.Draft.ProposedName, "Pike Place Market")
	}
	if env.Draft.Evidence.CurrentAddressName != "47.6062, -122.3321" {
		t.Errorf("Evidence.CurrentAddressName = %q, want coord-shaped string", env.Draft.Evidence.CurrentAddressName)
	}
	if env.Draft.Evidence.VisitCount != 12 {
		t.Errorf("Evidence.VisitCount = %d, want 12", env.Draft.Evidence.VisitCount)
	}
	if env.Draft.Evidence.TotalDurationS != 3*3600*12 {
		t.Errorf("Evidence.TotalDurationS = %v, want %v", env.Draft.Evidence.TotalDurationS, 3*3600*12)
	}
	if env.Draft.Evidence.LastVisitedAt != "2024-10-14T18:30:00Z" {
		t.Errorf("Evidence.LastVisitedAt = %q, want %q", env.Draft.Evidence.LastVisitedAt, "2024-10-14T18:30:00Z")
	}
	if env.Draft.Evidence.FirstVisitedAt != "2024-07-15T09:00:00Z" {
		t.Errorf("Evidence.FirstVisitedAt = %q, want %q", env.Draft.Evidence.FirstVisitedAt, "2024-07-15T09:00:00Z")
	}
	if got := len(validator.calls); got != 1 {
		t.Fatalf("validator.calls = %d, want 1", got)
	}
	if validator.calls[0].Proposed != "Pike Place Market" {
		t.Errorf("validator.calls[0].Proposed = %q, want %q",
			validator.calls[0].Proposed, "Pike Place Market")
	}
}

// TestDraftLocationName_ValidatorFailureSurfacesAsInvalid proves
// the validator's verdict is propagated as status="invalid" + the
// error text in ValidationError. The Draft is still returned so
// the UI can show the partially-correct proposal.
func TestDraftLocationName_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	locations := newTestLocationFixtures()
	validator := &stubLocationNameValidator{failWith: errors.New("location name too long")}
	tool := &draftLocationName{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"location_id": 501,
		"proposed_name": "A long but acceptable name"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must not error)", err)
	}
	env := out.(*locationNameDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if !strings.Contains(env.ValidationError, "too long") {
		t.Errorf("ValidationError = %q, want substring %q", env.ValidationError, "too long")
	}
	if env.Draft == nil {
		t.Fatal("Draft is nil on invalid (must still be returned for UI to render)")
	}
}

// TestDraftLocationName_MissingLocationIsError proves a locationID
// that does not exist surfaces as a returned error (not
// status="invalid") so the LLM can retry with a different ID.
func TestDraftLocationName_MissingLocationIsError(t *testing.T) {
	t.Parallel()
	locations := &stubLocationSource{byID: map[int64]*geomodel.VisitedLocation{}}
	validator := &stubLocationNameValidator{}
	tool := &draftLocationName{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"location_id": 9999, "proposed_name": "Anywhere"}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want non-nil for missing location")
	}
	if !strings.Contains(err.Error(), "visited-location not found") {
		t.Errorf("Execute err = %v, want substring %q", err, "visited-location not found")
	}
}

// TestDraftLocationName_NilWiringSurfacesAsError proves the
// defensive nil-checks return a plain error rather than panicking,
// which is the same shape the auto-trip-naming tools use.
func TestDraftLocationName_NilWiringSurfacesAsError(t *testing.T) {
	t.Parallel()
	tool := &draftLocationName{}
	in, err := tool.Validate(json.RawMessage(`{"location_id": 1, "proposed_name": "x"}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no LocationSource wired)")
	}
}

// TestValidateLocationName_HappyPath_OK proves the validate-only
// tool returns status="ok".
func TestValidateLocationName_HappyPath_OK(t *testing.T) {
	t.Parallel()
	locations := newTestLocationFixtures()
	validator := &stubLocationNameValidator{}
	tool := &validateLocationNameTool{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"location_id": 501,
		"proposed_name": "Home"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*locationNameValidateOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *locationNameValidateOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty", env.ValidationError)
	}
}

func TestValidateLocationName_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	locations := newTestLocationFixtures()
	validator := &stubLocationNameValidator{failWith: errors.New("location name must not be empty")}
	tool := &validateLocationNameTool{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"location_id": 501, "proposed_name": " "}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must not error)", err)
	}
	env := out.(*locationNameValidateOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if !strings.Contains(env.ValidationError, "must not be empty") {
		t.Errorf("ValidationError = %q, want substring %q", env.ValidationError, "must not be empty")
	}
}

// TestLocationNameTools_AreReadOnly pins the Mutates() contract on
// both tools — the dispatcher's deny-all confirm hook would refuse
// them if they returned true, so a future edit that flips either
// flag must update this test (and the confirm hook).
func TestLocationNameTools_AreReadOnly(t *testing.T) {
	t.Parallel()
	if (&draftLocationName{}).Mutates() {
		t.Error("draftLocationName.Mutates() = true, want false (propose-only)")
	}
	if (&validateLocationNameTool{}).Mutates() {
		t.Error("validateLocationNameTool.Mutates() = true, want false (propose-only)")
	}
}

// TestValidateLocationNameShape_TableDriven pins the shared
// validator helper used by the production
// *api.AILocationNameValidator wrapper. Each row exercises one
// rule documented on the function.
func TestValidateLocationNameShape_TableDriven(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		wantErr string // empty = pass
	}{
		{"empty", "", "must not be empty"},
		{"whitespace_only", "   ", "non-whitespace"},
		{"leading_space", " Home", "leading or trailing"},
		{"trailing_space", "Home ", "leading or trailing"},
		{"leading_tab", "\tHome", "leading or trailing"},
		{"control_char", "Home\x07Office", "control characters"},
		{"happy_short", "Home", ""},
		{"happy_with_emoji", "🏠 Home", ""},
		{"happy_max", strings.Repeat("a", 200), ""},
		{"over_max", strings.Repeat("a", 201), "at most 200"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateLocationNameShape(tc.input)
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("validateLocationNameShape(%q) err = %v, want nil", tc.input, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("validateLocationNameShape(%q) err = nil, want substring %q", tc.input, tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validateLocationNameShape(%q) err = %q, want substring %q", tc.input, err.Error(), tc.wantErr)
			}
		})
	}
}

// TestRegisterAutoNameUnnamedLocationsTools_RegistersBothTools
// proves the helper installs both tools by name and they round-trip
// through the registry's Lookup.
func TestRegisterAutoNameUnnamedLocationsTools_RegistersBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	locations := newTestLocationFixtures()
	validator := &stubLocationNameValidator{}
	RegisterAutoNameUnnamedLocationsTools(r, AutoNameUnnamedLocationsSources{
		Locations: locations,
		Validator: validator,
	})
	for _, name := range []string{"draft_location_name", "validate_location_name"} {
		tool, ok := r.Get(name)
		if !ok {
			t.Errorf("registry missing tool %q", name)
			continue
		}
		if tool.Mutates() {
			t.Errorf("registered tool %q.Mutates() = true, want false", name)
		}
	}
}
