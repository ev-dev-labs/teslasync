// Phase-50 / 0031 — T1 Preheat and precool recommender.
//
// Unit tests for draft_climate_schedule + validate_climate_schedule.
// Both tools are propose-only and hermetic — the tests substitute a
// deterministic [fakeClimateScheduleAdvisor] for the advisor and run
// the validator with pure-Go arithmetic. No DB / network / clock
// dependency.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// draft_climate_schedule
// ---------------------------------------------------------------------------

// fakeClimateScheduleAdvisor is a hermetic stand-in for
// *api.AIClimateScheduleAdvisor. It records the request and returns
// the canned result or error.
type fakeClimateScheduleAdvisor struct {
	last *ClimateScheduleDraftRequest
	out  *ClimateScheduleDraftResult
	err  error
}

func (f *fakeClimateScheduleAdvisor) DraftClimateSchedule(_ context.Context, req ClimateScheduleDraftRequest) (*ClimateScheduleDraftResult, error) {
	cp := req
	f.last = &cp
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestDraftClimateSchedule_DelegatesAndStampsStatus proves
// draft_climate_schedule passes the typed request through to the
// canonical advisor and returns the same envelope with a Status
// stamp.
func TestDraftClimateSchedule_DelegatesAndStampsStatus(t *testing.T) {
	t.Parallel()
	depart, _ := time.Parse(time.RFC3339, "2099-01-02T07:30:00Z")
	start, _ := time.Parse(time.RFC3339, "2099-01-02T07:00:00Z")
	end := depart
	canned := &ClimateScheduleDraftResult{
		VehicleID:         42,
		StartTime:         start,
		EndTime:           end,
		Mode:              "preheat",
		TargetCabinTempC:  21.0,
		CurrentCabinTempC: 4.0,
		OutsideTempC:      -2.0,
		DepartBy:          depart,
	}
	advisor := &fakeClimateScheduleAdvisor{out: canned}
	tool := &draftClimateSchedule{advisor: advisor}

	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"depart_by": "2099-01-02T07:30:00Z",
		"current_cabin_temp_c": 4.0,
		"outside_temp_c": -2.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*draftClimateScheduleOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty for ok status", env.ValidationError)
	}
	if env.Schedule == nil {
		t.Fatal("Schedule is nil")
	}
	if env.Schedule.Mode != "preheat" {
		t.Errorf("Schedule.Mode = %q, want preheat", env.Schedule.Mode)
	}
	if env.Schedule.TargetCabinTempC != 21.0 {
		t.Errorf("Schedule.TargetCabinTempC = %v, want 21.0", env.Schedule.TargetCabinTempC)
	}
	if advisor.last == nil {
		t.Fatal("advisor.last is nil; DraftClimateSchedule never called")
	}
	if advisor.last.VehicleID != 42 {
		t.Errorf("advisor.last.VehicleID = %d, want 42", advisor.last.VehicleID)
	}
	if advisor.last.TargetCabinTempC != 21.0 {
		t.Errorf("advisor.last.TargetCabinTempC = %v, want 21.0", advisor.last.TargetCabinTempC)
	}
}

// TestDraftClimateSchedule_SurfacesAdvisorErrorAsInvalidEnvelope
// proves an advisor-feasibility error (e.g. "depart_by is in the
// past") is reflected back to the LLM as a typed
// {status:"invalid", validation_error:"..."} envelope rather than
// crashing the dispatcher.
func TestDraftClimateSchedule_SurfacesAdvisorErrorAsInvalidEnvelope(t *testing.T) {
	t.Parallel()
	advisor := &fakeClimateScheduleAdvisor{err: errors.New("depart_by is in the past")}
	tool := &draftClimateSchedule{advisor: advisor}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"depart_by": "1999-01-02T07:30:00Z",
		"current_cabin_temp_c": 4.0,
		"outside_temp_c": -2.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (feasibility errors return a typed envelope)", err)
	}
	env := out.(*draftClimateScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "depart_by is in the past") {
		t.Errorf("ValidationError = %q, want substring 'depart_by is in the past'", env.ValidationError)
	}
	if env.Schedule != nil {
		t.Errorf("Schedule = %+v, want nil for invalid status", env.Schedule)
	}
}

// TestDraftClimateSchedule_NoAdvisorWired proves a missing
// ClimateScheduleAdvisor is reported as an Execute error so a
// wiring bug surfaces clearly at first call rather than at boot.
func TestDraftClimateSchedule_NoAdvisorWired(t *testing.T) {
	t.Parallel()
	tool := &draftClimateSchedule{advisor: nil}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"depart_by": "2099-01-02T07:30:00Z",
		"current_cabin_temp_c": 4.0,
		"outside_temp_c": -2.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil advisor")
	}
	if !strings.Contains(err.Error(), "no ClimateScheduleAdvisor") {
		t.Errorf("Execute err = %v, want 'no ClimateScheduleAdvisor' message", err)
	}
}

// TestDraftClimateSchedule_PropOnlyContract pins the propose-only
// metadata.
func TestDraftClimateSchedule_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &draftClimateSchedule{}
	if tool.Name() != "draft_climate_schedule" {
		t.Errorf("Name() = %q, want draft_climate_schedule", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// ---------------------------------------------------------------------------
// validate_climate_schedule
// ---------------------------------------------------------------------------

// TestValidateClimateSchedule_PreheatOK proves a fully-consistent
// preheat envelope returns Status=ok.
func TestValidateClimateSchedule_PreheatOK(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T07:00:00Z",
		"end_time": "2099-01-02T07:30:00Z",
		"depart_by": "2099-01-02T07:30:00Z",
		"mode": "preheat",
		"current_cabin_temp_c": 4.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateClimateScheduleOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
}

// TestValidateClimateSchedule_PrecoolOK proves a fully-consistent
// precool envelope returns Status=ok.
func TestValidateClimateSchedule_PrecoolOK(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-07-02T17:00:00Z",
		"end_time": "2099-07-02T17:30:00Z",
		"depart_by": "2099-07-02T17:30:00Z",
		"mode": "precool",
		"current_cabin_temp_c": 38.0,
		"target_cabin_temp_c": 22.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateClimateScheduleOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
}

// TestValidateClimateSchedule_RejectsEndAfterDepart proves the
// boundary-after-depart_by case is caught.
func TestValidateClimateSchedule_RejectsEndAfterDepart(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T07:00:00Z",
		"end_time": "2099-01-02T08:00:00Z",
		"depart_by": "2099-01-02T07:30:00Z",
		"mode": "preheat",
		"current_cabin_temp_c": 4.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateClimateScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "end_time") {
		t.Errorf("ValidationError = %q, want substring 'end_time'", env.ValidationError)
	}
}

// TestValidateClimateSchedule_RejectsEndBeforeStart proves
// start>=end fails fast.
func TestValidateClimateSchedule_RejectsEndBeforeStart(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T07:30:00Z",
		"end_time": "2099-01-02T07:00:00Z",
		"depart_by": "2099-01-02T08:00:00Z",
		"mode": "preheat",
		"current_cabin_temp_c": 4.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateClimateScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "strictly after") {
		t.Errorf("ValidationError = %q, want substring 'strictly after'", env.ValidationError)
	}
}

// TestValidateClimateSchedule_PreheatRequiresWarming proves
// mode=preheat with target<=current is rejected so the LLM can't
// quote a confused envelope.
func TestValidateClimateSchedule_PreheatRequiresWarming(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T07:00:00Z",
		"end_time": "2099-01-02T07:30:00Z",
		"depart_by": "2099-01-02T07:30:00Z",
		"mode": "preheat",
		"current_cabin_temp_c": 22.0,
		"target_cabin_temp_c": 21.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateClimateScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "preheat requires") {
		t.Errorf("ValidationError = %q, want substring 'preheat requires'", env.ValidationError)
	}
}

// TestValidateClimateSchedule_PrecoolRequiresCooling proves
// mode=precool with target>=current is rejected.
func TestValidateClimateSchedule_PrecoolRequiresCooling(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-07-02T17:00:00Z",
		"end_time": "2099-07-02T17:30:00Z",
		"depart_by": "2099-07-02T17:30:00Z",
		"mode": "precool",
		"current_cabin_temp_c": 20.0,
		"target_cabin_temp_c": 22.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateClimateScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "precool requires") {
		t.Errorf("ValidationError = %q, want substring 'precool requires'", env.ValidationError)
	}
}

// TestValidateClimateSchedule_PropOnlyContract pins the
// propose-only metadata.
func TestValidateClimateSchedule_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &validateClimateSchedule{}
	if tool.Name() != "validate_climate_schedule" {
		t.Errorf("Name() = %q, want validate_climate_schedule", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TestRegisterPreheatPrecoolRecommenderTools proves the registrar
// installs both tools onto the registry under their canonical names.
func TestRegisterPreheatPrecoolRecommenderTools(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	advisor := &fakeClimateScheduleAdvisor{out: &ClimateScheduleDraftResult{}}
	RegisterPreheatPrecoolRecommenderTools(r, PreheatPrecoolRecommenderSources{Advisor: advisor})
	for _, want := range []string{"draft_climate_schedule", "validate_climate_schedule"} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing tool %q", want)
		}
	}
}
