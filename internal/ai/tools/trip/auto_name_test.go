// Phase-50 / 0024 — D4 Auto trip naming.
//
// Tool tests for draft_trip_name + validate_trip_name. Both tools are
// pure functions over input + TripSource / TripDetailSource /
// TripNameValidator interfaces; the tests stub all three with
// deterministic fakes so the tests stay hermetic (no api or database
// package, no DB).

package trip

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// stubTripSource is a deterministic fake for TripSource.
type stubTripSource struct {
	byID map[int64]*models.Trip
	err  error
}

func (s *stubTripSource) GetTripByID(_ context.Context, tripID int64) (*models.Trip, error) {
	if s.err != nil {
		return nil, s.err
	}
	if t, ok := s.byID[tripID]; ok {
		return t, nil
	}
	return nil, nil
}

// stubTripDetailSource is a deterministic fake for TripDetailSource.
type stubTripDetailSource struct {
	byID map[int64]*database.TripDetail
	err  error
}

func (s *stubTripDetailSource) GetTrip(_ context.Context, tripID int64) (*database.TripDetail, error) {
	if s.err != nil {
		return nil, s.err
	}
	if d, ok := s.byID[tripID]; ok {
		return d, nil
	}
	return nil, nil
}

// stubTripNameValidator records every call + can be wired to fail
// for the rejection-path tests.
type stubTripNameValidator struct {
	failWith error
	calls    []struct {
		Trip     *models.Trip
		Proposed string
	}
}

func (s *stubTripNameValidator) ValidateTripName(trip *models.Trip, proposed string) error {
	s.calls = append(s.calls, struct {
		Trip     *models.Trip
		Proposed string
	}{trip, proposed})
	return s.failWith
}

// newTestTripFixtures builds a deterministic trip + detail pair for
// id=101 used by most of the happy-path tests.
func newTestTripFixtures() (*stubTripSource, *stubTripDetailSource) {
	startedAt := time.Date(2024, 10, 12, 8, 30, 0, 0, time.UTC)
	endedAt := time.Date(2024, 10, 13, 18, 45, 0, 0, time.UTC)
	startPlace := "Seattle, WA"
	endPlace := "Portland, OR"
	currentName := "Trip #101"
	trip := &models.Trip{
		ID:        101,
		VehicleID: 7,
		Name:      "Trip #101",
		StartedAt: startedAt,
		EndedAt:   &endedAt,
	}
	detail := &database.TripDetail{
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
		Drives: []database.TripDriveSummary{
			{ID: 5001, StartedAt: startedAt, StartPlace: &startPlace, EndPlace: ptrString("Olympia, WA")},
			{ID: 5002, StartedAt: startedAt.Add(2 * time.Hour), StartPlace: ptrString("Olympia, WA"), EndPlace: &endPlace},
		},
	}
	return &stubTripSource{byID: map[int64]*models.Trip{101: trip}},
		&stubTripDetailSource{byID: map[int64]*database.TripDetail{101: detail}}
}

func ptrString(s string) *string { return &s }

// TestDraftTripName_HappyPath_OK proves a valid LLM payload yields
// status="ok" + a draft envelope grounded in the trip's actual
// route context (start_place, end_place, drive count, time window).
func TestDraftTripName_HappyPath_OK(t *testing.T) {
	t.Parallel()
	trips, details := newTestTripFixtures()
	validator := &stubTripNameValidator{}
	tool := &draftTripName{trips: trips, details: details, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_name": "Weekend Road Trip — October 2024"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*tripNameDraftOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *tripNameDraftOutput", out)
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
	if env.Draft.TripID != 101 {
		t.Errorf("Draft.TripID = %d, want 101", env.Draft.TripID)
	}
	if env.Draft.VehicleID != 7 {
		t.Errorf("Draft.VehicleID = %d, want 7", env.Draft.VehicleID)
	}
	if env.Draft.ProposedName != "Weekend Road Trip — October 2024" {
		t.Errorf("Draft.ProposedName = %q, want %q", env.Draft.ProposedName, "Weekend Road Trip — October 2024")
	}
	if env.Draft.Evidence.StartPlace == nil || *env.Draft.Evidence.StartPlace != "Seattle, WA" {
		t.Errorf("Evidence.StartPlace = %v, want Seattle, WA", env.Draft.Evidence.StartPlace)
	}
	if env.Draft.Evidence.EndPlace == nil || *env.Draft.Evidence.EndPlace != "Portland, OR" {
		t.Errorf("Evidence.EndPlace = %v, want Portland, OR", env.Draft.Evidence.EndPlace)
	}
	if env.Draft.Evidence.DriveCount != 2 {
		t.Errorf("Evidence.DriveCount = %d, want 2", env.Draft.Evidence.DriveCount)
	}
	if env.Draft.Evidence.DistanceM != 287_500 {
		t.Errorf("Evidence.DistanceM = %v, want 287500", env.Draft.Evidence.DistanceM)
	}
	if env.Draft.Evidence.CurrentName != "Trip #101" {
		t.Errorf("Evidence.CurrentName = %q, want %q", env.Draft.Evidence.CurrentName, "Trip #101")
	}
	if env.Draft.Evidence.StartedAt != "2024-10-12T08:30:00Z" {
		t.Errorf("Evidence.StartedAt = %q, want %q", env.Draft.Evidence.StartedAt, "2024-10-12T08:30:00Z")
	}
	if env.Draft.Evidence.EndedAt != "2024-10-13T18:45:00Z" {
		t.Errorf("Evidence.EndedAt = %q, want %q", env.Draft.Evidence.EndedAt, "2024-10-13T18:45:00Z")
	}
	if got := len(validator.calls); got != 1 {
		t.Fatalf("validator.calls = %d, want 1", got)
	}
	if validator.calls[0].Proposed != "Weekend Road Trip — October 2024" {
		t.Errorf("validator.calls[0].Proposed = %q, want %q",
			validator.calls[0].Proposed, "Weekend Road Trip — October 2024")
	}
}

// TestDraftTripName_ValidatorFailureSurfacesAsInvalid proves the
// validator's verdict is propagated as status="invalid" + the
// error text in ValidationError. The Draft is still returned so
// the UI can show the partially-correct proposal.
func TestDraftTripName_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	trips, details := newTestTripFixtures()
	validator := &stubTripNameValidator{failWith: errors.New("trip name too long")}
	tool := &draftTripName{trips: trips, details: details, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_name": "A long but acceptable name"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must not error)", err)
	}
	env := out.(*tripNameDraftOutput)
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

// TestDraftTripName_MissingTripIsError proves a tripID that does
// not exist surfaces as a returned error (not status="invalid")
// so the LLM can retry with a different ID.
func TestDraftTripName_MissingTripIsError(t *testing.T) {
	t.Parallel()
	trips := &stubTripSource{byID: map[int64]*models.Trip{}}
	details := &stubTripDetailSource{byID: map[int64]*database.TripDetail{}}
	validator := &stubTripNameValidator{}
	tool := &draftTripName{trips: trips, details: details, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"trip_id": 9999, "proposed_name": "Anywhere"}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want non-nil for missing trip")
	}
	if !strings.Contains(err.Error(), "trip not found") {
		t.Errorf("Execute err = %v, want substring %q", err, "trip not found")
	}
}

// TestDraftTripName_NilWiringPanicsSafelyAsError proves the
// defensive nil-checks return a plain error rather than panicking,
// which is the same shape the alert-builder tools use.
func TestDraftTripName_NilWiringSurfacesAsError(t *testing.T) {
	t.Parallel()
	tool := &draftTripName{}
	in, err := tool.Validate(json.RawMessage(`{"trip_id": 1, "proposed_name": "x"}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no TripSource wired)")
	}
}

// TestValidateTripName_HappyPath_OK proves the validate-only tool
// returns status="ok" without touching the detail repo.
func TestValidateTripName_HappyPath_OK(t *testing.T) {
	t.Parallel()
	trips, _ := newTestTripFixtures()
	validator := &stubTripNameValidator{}
	tool := &validateTripNameTool{trips: trips, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{
		"trip_id": 101,
		"proposed_name": "Coast Trip"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*tripNameValidateOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *tripNameValidateOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty", env.ValidationError)
	}
}

// TestValidateTripName_ValidatorFailureSurfacesAsInvalid.
func TestValidateTripName_ValidatorFailureSurfacesAsInvalid(t *testing.T) {
	t.Parallel()
	trips, _ := newTestTripFixtures()
	validator := &stubTripNameValidator{failWith: errors.New("trip name must not be empty")}
	tool := &validateTripNameTool{trips: trips, validator: validator}

	in, err := tool.Validate(json.RawMessage(`{"trip_id": 101, "proposed_name": " "}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must not error)", err)
	}
	env := out.(*tripNameValidateOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if !strings.Contains(env.ValidationError, "must not be empty") {
		t.Errorf("ValidationError = %q, want substring %q", env.ValidationError, "must not be empty")
	}
}

// TestTripNameTools_AreReadOnly pins the Mutates() contract on both
// tools — the dispatcher's deny-all confirm hook would refuse them
// if they returned true, so a future edit that flips either flag
// must update this test (and the confirm hook).
func TestTripNameTools_AreReadOnly(t *testing.T) {
	t.Parallel()
	if (&draftTripName{}).Mutates() {
		t.Error("draftTripName.Mutates() = true, want false (propose-only)")
	}
	if (&validateTripNameTool{}).Mutates() {
		t.Error("validateTripNameTool.Mutates() = true, want false (propose-only)")
	}
}

// TestValidateTripNameShape_TableDriven pins the shared validator
// helper used by the production *api.AITripNameValidator wrapper.
// Each row exercises one rule documented on the function.
func TestValidateTripNameShape_TableDriven(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		wantErr string // empty = pass
	}{
		{"empty", "", "must not be empty"},
		{"whitespace_only", "   ", "non-whitespace"},
		{"leading_space", " Road Trip", "leading or trailing"},
		{"trailing_space", "Road Trip ", "leading or trailing"},
		{"leading_tab", "\tRoad Trip", "leading or trailing"},
		{"control_char", "Road\x07Trip", "control characters"},
		{"happy_short", "Road Trip", ""},
		{"happy_with_emoji", "🚗 Road Trip", ""},
		{"happy_max", strings.Repeat("a", 200), ""},
		{"over_max", strings.Repeat("a", 201), "at most 200"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateTripNameShape(tc.input)
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("validateTripNameShape(%q) err = %v, want nil", tc.input, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("validateTripNameShape(%q) err = nil, want substring %q", tc.input, tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validateTripNameShape(%q) err = %q, want substring %q", tc.input, err.Error(), tc.wantErr)
			}
		})
	}
}

// TestRegisterAutoTripNamingTools_RegistersBothTools proves the
// helper installs both tools by name and they round-trip through
// the registry's Lookup.
func TestRegisterAutoTripNamingTools_RegistersBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	trips, details := newTestTripFixtures()
	validator := &stubTripNameValidator{}
	RegisterAutoTripNamingTools(r, AutoTripNamingSources{
		Trips:     trips,
		Details:   details,
		Validator: validator,
	})
	for _, name := range []string{"draft_trip_name", "validate_trip_name"} {
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
