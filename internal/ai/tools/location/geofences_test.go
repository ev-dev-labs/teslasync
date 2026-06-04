// Suggested geofence tool tests.
//
// Tool tests for draft_geofence + validate_geofence. Both tools are
// pure functions over input + LocationSource + GeofenceValidator
// interfaces; the tests stub both with deterministic fakes so the
// tests stay hermetic (no api or database package, no DB).

package location

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// stubGeofenceValidator records every call + can be wired to fail
// for the rejection-path tests. Mirrors stubLocationNameValidator's
// shape from auto_name_unnamed_locations_test.go.
type stubGeofenceValidator struct {
	failWith error
	calls    []struct {
		Loc      *geomodel.VisitedLocation
		Proposed string
		RadiusM  float64
	}
}

func (s *stubGeofenceValidator) ValidateGeofence(loc *geomodel.VisitedLocation, proposed string, radiusM float64) error {
	s.calls = append(s.calls, struct {
		Loc      *geomodel.VisitedLocation
		Proposed string
		RadiusM  float64
	}{loc, proposed, radiusM})
	return s.failWith
}

// newGeofenceTestFixtures builds a deterministic visited-location
// for id=501 used by most of the happy-path tests. The address_name
// is coordinate-shaped (the geocoder fallback) so the centroid
// extractor returns the expected lat/lon.
func newGeofenceTestFixtures() *stubLocationSource {
	createdAt := time.Date(2024, 7, 15, 9, 0, 0, 0, time.UTC)
	lastVisited := time.Date(2024, 10, 14, 18, 30, 0, 0, time.UTC)
	loc := &geomodel.VisitedLocation{
		ID:             501,
		VehicleID:      7,
		AddressName:    "47.6062, -122.3321",
		VisitCount:     12,
		TotalDurationS: 3 * 3600 * 12,
		LastVisited:    &lastVisited,
		CreatedAt:      createdAt,
	}
	return &stubLocationSource{byID: map[int64]*geomodel.VisitedLocation{501: loc}}
}

// TestDraftGeofence_HappyPath_OK proves a valid LLM payload yields
// status="ok" + a draft envelope grounded in the location's actual
// visit evidence.
func TestDraftGeofence_HappyPath_OK(t *testing.T) {
	t.Parallel()
	locations := newGeofenceTestFixtures()
	validator := &stubGeofenceValidator{}
	tool := &draftGeofence{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"location_id": 501,
		"proposed_name": "Frequent Stop",
		"radius_m": 150
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*geofenceDraftOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *geofenceDraftOutput", out)
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
	if env.Draft.ProposedName != "Frequent Stop" {
		t.Errorf("Draft.ProposedName = %q, want %q", env.Draft.ProposedName, "Frequent Stop")
	}
	if env.Draft.RadiusM != 150 {
		t.Errorf("Draft.RadiusM = %v, want 150", env.Draft.RadiusM)
	}
	// Centroid extracted from coordinate-shaped address_name.
	if math.Abs(env.Draft.CentroidLat-47.6062) > 1e-6 {
		t.Errorf("Draft.CentroidLat = %v, want ~47.6062", env.Draft.CentroidLat)
	}
	if math.Abs(env.Draft.CentroidLon-(-122.3321)) > 1e-6 {
		t.Errorf("Draft.CentroidLon = %v, want ~-122.3321", env.Draft.CentroidLon)
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
	if validator.calls[0].Proposed != "Frequent Stop" {
		t.Errorf("validator.calls[0].Proposed = %q, want %q",
			validator.calls[0].Proposed, "Frequent Stop")
	}
	if validator.calls[0].RadiusM != 150 {
		t.Errorf("validator.calls[0].RadiusM = %v, want 150", validator.calls[0].RadiusM)
	}
}

// TestDraftGeofence_ValidatorFailureSurfacesAsInvalid proves the
// validator's verdict is propagated as status="invalid" + the error
// text in ValidationError. The Draft is still returned so the UI
// can show the partially-correct proposal.
func TestDraftGeofence_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	locations := newGeofenceTestFixtures()
	validator := &stubGeofenceValidator{failWith: errors.New("geofence radius must be at most 1000 meters")}
	tool := &draftGeofence{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"location_id": 501,
		"proposed_name": "Big Area",
		"radius_m": 999
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must not error)", err)
	}
	env := out.(*geofenceDraftOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if !strings.Contains(env.ValidationError, "at most 1000") {
		t.Errorf("ValidationError = %q, want substring %q", env.ValidationError, "at most 1000")
	}
	if env.Draft == nil {
		t.Fatal("Draft is nil on invalid (must still be returned for UI to render)")
	}
}

// TestDraftGeofence_MissingLocationIsError proves a locationID that
// does not exist surfaces as a returned error (not status="invalid")
// so the LLM can retry with a different ID.
func TestDraftGeofence_MissingLocationIsError(t *testing.T) {
	t.Parallel()
	locations := &stubLocationSource{byID: map[int64]*geomodel.VisitedLocation{}}
	validator := &stubGeofenceValidator{}
	tool := &draftGeofence{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"location_id": 9999, "proposed_name": "Anywhere", "radius_m": 100}`))
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

// TestDraftGeofence_NilWiringSurfacesAsError proves the defensive
// nil-checks return a plain error rather than panicking.
func TestDraftGeofence_NilWiringSurfacesAsError(t *testing.T) {
	t.Parallel()
	tool := &draftGeofence{}
	in, err := tool.Validate(json.RawMessage(`{"location_id": 1, "proposed_name": "x", "radius_m": 100}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no LocationSource wired)")
	}
}

// TestDraftGeofence_NonCoordAddressLeavesCentroidZero proves a
// location whose address_name is a human-readable label (not a
// "lat, lon" string) yields a draft with centroid = (0, 0). The SPA
// then falls back to its usual map-pick affordance for that field.
func TestDraftGeofence_NonCoordAddressLeavesCentroidZero(t *testing.T) {
	t.Parallel()
	createdAt := time.Date(2024, 7, 15, 9, 0, 0, 0, time.UTC)
	loc := &geomodel.VisitedLocation{
		ID:          502,
		VehicleID:   7,
		AddressName: "Pike Place Market",
		VisitCount:  3,
		CreatedAt:   createdAt,
	}
	locations := &stubLocationSource{byID: map[int64]*geomodel.VisitedLocation{502: loc}}
	validator := &stubGeofenceValidator{}
	tool := &draftGeofence{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"location_id": 502, "proposed_name": "Pike Place Market", "radius_m": 200}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*geofenceDraftOutput)
	if env.Status != "ok" {
		t.Fatalf("Status = %q, want ok", env.Status)
	}
	if env.Draft.CentroidLat != 0 || env.Draft.CentroidLon != 0 {
		t.Errorf("Centroid = (%v, %v), want (0, 0) for non-coord address",
			env.Draft.CentroidLat, env.Draft.CentroidLon)
	}
}

// TestValidateGeofence_HappyPath_OK proves the validate-only tool
// returns status="ok".
func TestValidateGeofence_HappyPath_OK(t *testing.T) {
	t.Parallel()
	locations := newGeofenceTestFixtures()
	validator := &stubGeofenceValidator{}
	tool := &validateGeofenceTool{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"location_id": 501,
		"proposed_name": "Home",
		"radius_m": 100
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*geofenceValidateOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *geofenceValidateOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty", env.ValidationError)
	}
}

// TestValidateGeofence_ValidatorFailureSurfacesAsInvalid.
func TestValidateGeofence_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	locations := newGeofenceTestFixtures()
	validator := &stubGeofenceValidator{failWith: errors.New("geofence name must not be empty")}
	tool := &validateGeofenceTool{locations: locations, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"location_id": 501, "proposed_name": " ", "radius_m": 100}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must not error)", err)
	}
	env := out.(*geofenceValidateOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if !strings.Contains(env.ValidationError, "must not be empty") {
		t.Errorf("ValidationError = %q, want substring %q", env.ValidationError, "must not be empty")
	}
}

// TestGeofenceTools_AreReadOnly pins the Mutates() contract on both
// tools — the dispatcher's deny-all confirm hook would refuse them
// if they returned true, so a future edit that flips either flag
// must update this test (and the confirm hook).
func TestGeofenceTools_AreReadOnly(t *testing.T) {
	t.Parallel()
	if (&draftGeofence{}).Mutates() {
		t.Error("draftGeofence.Mutates() = true, want false (propose-only)")
	}
	if (&validateGeofenceTool{}).Mutates() {
		t.Error("validateGeofenceTool.Mutates() = true, want false (propose-only)")
	}
}

// TestValidateGeofenceShape_TableDriven pins the shared validator
// helper used by the production *api.AISuggestGeofenceValidator
// wrapper. Each row exercises one rule documented on the function.
func TestValidateGeofenceShape_TableDriven(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		radius  float64
		wantErr string // empty = pass
	}{
		// Name-shape rules.
		{"empty_name", "", 100, "must not be empty"},
		{"whitespace_only", "   ", 100, "non-whitespace"},
		{"leading_space", " Home", 100, "leading or trailing"},
		{"trailing_space", "Home ", 100, "leading or trailing"},
		{"leading_tab", "\tHome", 100, "leading or trailing"},
		{"control_char", "Home\x07Office", 100, "control characters"},
		{"happy_short", "Home", 100, ""},
		{"happy_with_emoji", "🏠 Home", 100, ""},
		{"happy_max", strings.Repeat("a", 200), 100, ""},
		{"over_max_name", strings.Repeat("a", 201), 100, "at most 200"},
		// Radius rules.
		{"radius_zero", "Home", 0, "must be at least 50"},
		{"radius_just_under", "Home", 49.999, "must be at least 50"},
		{"radius_min_inclusive", "Home", 50, ""},
		{"radius_max_inclusive", "Home", 1000, ""},
		{"radius_just_over", "Home", 1000.001, "must be at most 1000"},
		{"radius_huge", "Home", 5000, "must be at most 1000"},
		{"radius_nan", "Home", math.NaN(), "finite"},
		{"radius_inf", "Home", math.Inf(1), "finite"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateGeofenceShape(tc.input, tc.radius)
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("validateGeofenceShape(%q, %v) err = %v, want nil", tc.input, tc.radius, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("validateGeofenceShape(%q, %v) err = nil, want substring %q", tc.input, tc.radius, tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validateGeofenceShape(%q, %v) err = %q, want substring %q", tc.input, tc.radius, err.Error(), tc.wantErr)
			}
		})
	}
}

// TestParseCentroidFromAddress_TableDriven pins the centroid-extractor
// helper. Documents the accepted input formats AND the rejection of
// malformed strings (which is the dominant case for human-readable
// labels).
func TestParseCentroidFromAddress_TableDriven(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		wantLat float64
		wantLon float64
		wantOK  bool
	}{
		{"comma_space", "47.6062, -122.3321", 47.6062, -122.3321, true},
		{"comma_no_space", "47.6062,-122.3321", 47.6062, -122.3321, true},
		{"space_only", "47.6062 -122.3321", 47.6062, -122.3321, true},
		{"leading_trailing_space", "  47.6062, -122.3321  ", 47.6062, -122.3321, true},
		{"empty", "", 0, 0, false},
		{"whitespace_only", "   ", 0, 0, false},
		{"not_numeric", "Pike Place Market", 0, 0, false},
		{"single_value", "47.6062", 0, 0, false},
		{"three_values", "47.6062, -122.3321, 99", 0, 0, false},
		{"out_of_range_lat", "200, 0", 0, 0, false},
		{"out_of_range_lon", "0, 200", 0, 0, false},
		{"negative_lat", "-89.5, 12.3", -89.5, 12.3, true},
		{"zero_zero", "0, 0", 0, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lat, lon, ok := parseCentroidFromAddress(tc.input)
			if ok != tc.wantOK {
				t.Errorf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if math.Abs(lat-tc.wantLat) > 1e-6 {
				t.Errorf("lat = %v, want %v", lat, tc.wantLat)
			}
			if math.Abs(lon-tc.wantLon) > 1e-6 {
				t.Errorf("lon = %v, want %v", lon, tc.wantLon)
			}
		})
	}
}

// TestRegisterSuggestNewGeofencesTools_RegistersBothTools proves the
// helper installs both tools by name and they round-trip through the
// registry's Get.
func TestRegisterSuggestNewGeofencesTools_RegistersBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	locations := newGeofenceTestFixtures()
	validator := &stubGeofenceValidator{}
	RegisterSuggestNewGeofencesTools(r, SuggestNewGeofencesSources{
		Locations: locations,
		Validator: validator,
	})
	for _, name := range []string{"draft_geofence", "validate_geofence"} {
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
